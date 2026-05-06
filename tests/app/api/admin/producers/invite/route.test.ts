// Vitest pour POST /api/admin/producers/invite.
// Couverture des 4 cas existants + edge case draft resend (chantier
// "Flux invitation : cas 'email déjà en base'", session 28/04).
//
// Pattern multi-table aligné sur tests/app/api/orders/[id]/cancel/route.test.ts :
// queues séparées par opération (select / update / insert) pour permettre des
// SELECT/UPDATE/INSERT indépendants sur producer_interests sans collision
// (le bump UPDATE n'avale pas le SELECT existingLead suivant).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Hoisted env stubs ---------------------------------------------------
// lib/env/urls.ts throw au module-load si NEXT_PUBLIC_APP_URL ou
// NEXT_PUBLIC_PRODUCER_URL manquent. La route les charge transitivement.
// Idem OPT_OUT_TOKEN_SECRET pour generateOptOutToken.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002";
  process.env.OPT_OUT_TOKEN_SECRET =
    process.env.OPT_OUT_TOKEN_SECRET ?? "test-opt-out-secret";
});

// --- Hoisted mocks partagés avec les factories vi.mock -------------------
const { mockSendTemplate } = vi.hoisted(() => ({
  mockSendTemplate: vi.fn(),
}));

vi.mock("@/lib/resend/send", () => ({
  sendTemplate: mockSendTemplate,
}));

// Mock du template React (la route l'instancie avec JSX, on n'a pas besoin
// de l'évaluer puisque sendTemplate est mocké).
vi.mock("@/lib/resend/templates/producer-invitation", () => ({
  default: () => null,
  subject: () => "Invitation TerrOir",
}));

// T-310 — mock logAuthEvent : la SUT l'appelle après l'INSERT invitation OK
// pour câbler l'event 'invitation_created'. On veut vérifier eventType +
// metadata sans déclencher l'INSERT réel dans audit_logs (suite dédiée).
vi.mock("@/lib/audit-logs/log-auth-event", () => ({
  logAuthEvent: vi.fn(),
}));

// --- Auth mock (closure variable) ----------------------------------------
type SessionUser = {
  id: string;
  email: string | null;
  roles: string[];
  isAdmin: boolean;
} | null;

let sessionUser: SessionUser;
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => sessionUser,
}));

// --- Supabase admin client mock ------------------------------------------
type Resp = { data?: unknown; error?: unknown };
type Op = "select" | "update" | "insert" | "pending";

type Captured = {
  fromCalls: string[];
  selects: Array<{ table: string; cols: string }>;
  updates: Array<{ table: string; payload: unknown }>;
  inserts: Array<{ table: string; payload: unknown }>;
  eqCalls: Array<{ table: string; col: string; val: unknown }>;
  ilikeCalls: Array<{ table: string; col: string; val: unknown }>;
  isCalls: Array<{ table: string; col: string; val: unknown }>;
  gtCalls: Array<{ table: string; col: string; val: unknown }>;
};

let captured: Captured;
let responses: Record<
  string,
  Partial<Record<"select" | "update" | "insert", Resp[]>>
>;

function defaultResp(table: string, op: Op): Resp {
  // Defaults qui font passer le flow nominal cas 1 (lead 'new'). Les tests
  // surchargent table par table. Notes :
  //   - admin_users SELECT : data=null (pas d'admin matché)
  //   - users SELECT : data=null (pas de user matché → cas 1)
  //   - producers SELECT : non atteint quand users SELECT renvoie null
  //   - producer_invitations UPDATE : data=[] (T-109 revoke no-op par défaut,
  //     aucune invitation active à bumper). Tests T-109 surchargent.
  //   - producer_invitations INSERT : succès, RETURNING id+token+expires_at
  //   - producer_interests UPDATE : 1 row bumpée (lead 'new' matché)
  if (op === "update") {
    if (table === "producer_invitations") {
      // T-109 : RETURNING id sur le UPDATE revoke. Empty array = no-op,
      // aucun event invitation_revoked émis (cohérent défaut H1/H3 qui
      // assertent logAuthEvent.toHaveBeenCalledTimes(1) = invitation_created
      // seul).
      return { data: [], error: null };
    }
    if (table === "producer_interests") {
      return { data: [{ id: "lead-1" }], error: null };
    }
    return { data: null, error: null };
  }
  if (op === "insert") {
    if (table === "producer_invitations") {
      return {
        data: {
          id: "inv-test",
          token: "tok-test",
          expires_at: "2030-01-01T00:00:00Z",
        },
        error: null,
      };
    }
    return { data: null, error: null };
  }
  return { data: null, error: null };
}

function consume(table: string, op: Op): Resp {
  if (op !== "pending") {
    const queue = responses[table]?.[op];
    if (queue && queue.length > 0) return queue.shift()!;
  }
  return defaultResp(table, op);
}

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      captured.fromCalls.push(table);
      const builder: Record<string, unknown> & { _op: Op } = { _op: "pending" };
      builder.select = (cols: string) => {
        captured.selects.push({ table, cols });
        // Premier appel après .from() → SELECT pur.
        // Appel après .insert(...) ou .update(...) → RETURNING clause,
        // l'op reste "insert"/"update", on ne l'écrase pas.
        if (builder._op === "pending") builder._op = "select";
        return builder;
      };
      builder.update = (payload: unknown) => {
        captured.updates.push({ table, payload });
        builder._op = "update";
        return builder;
      };
      builder.insert = (payload: unknown) => {
        captured.inserts.push({ table, payload });
        builder._op = "insert";
        return builder;
      };
      builder.eq = (col: string, val: unknown) => {
        captured.eqCalls.push({ table, col, val });
        return builder;
      };
      builder.ilike = (col: string, val: unknown) => {
        captured.ilikeCalls.push({ table, col, val });
        return builder;
      };
      builder.is = (col: string, val: unknown) => {
        captured.isCalls.push({ table, col, val });
        return builder;
      };
      builder.gt = (col: string, val: unknown) => {
        captured.gtCalls.push({ table, col, val });
        return builder;
      };
      builder.maybeSingle = () => Promise.resolve(consume(table, builder._op));
      builder.single = () => Promise.resolve(consume(table, builder._op));
      builder.then = (onFulfilled: (r: Resp) => unknown) =>
        onFulfilled(consume(table, builder._op));
      return builder;
    },
  }),
}));

// --- Import APRÈS les mocks ----------------------------------------------

import { POST } from "@/app/api/admin/producers/invite/route";
import { logAuthEvent } from "@/lib/audit-logs/log-auth-event";

// --- Helpers -------------------------------------------------------------

function makeRequest(body: unknown): Request {
  return {
    json: async () => body,
  } as unknown as Request;
}

function pushResp(
  table: string,
  op: "select" | "update" | "insert",
  ...resps: Resp[]
) {
  responses[table] = responses[table] ?? {};
  responses[table][op] = [...(responses[table][op] ?? []), ...resps];
}

const VALID_BODY = { email: "prospect@example.com" };

// --- Setup / teardown ----------------------------------------------------

let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  captured = {
    fromCalls: [],
    selects: [],
    updates: [],
    inserts: [],
    eqCalls: [],
    ilikeCalls: [],
    isCalls: [],
    gtCalls: [],
  };
  responses = {};
  // Default : admin valide.
  sessionUser = {
    id: "admin-1",
    email: "admin@example.com",
    roles: [],
    isAdmin: true,
  };
  mockSendTemplate
    .mockReset()
    .mockResolvedValue({ ok: true, id: "res_1" });
  vi.mocked(logAuthEvent).mockClear();
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- A. Auth & validation ------------------------------------------------

describe("A. Auth & validation", () => {
  it("A1 session absente → 403 Forbidden, sortie avant tout I/O", async () => {
    sessionUser = null;
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
    expect(captured.fromCalls).toEqual([]);
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });

  it("A2 session non-admin → 403 Forbidden", async () => {
    sessionUser = {
      id: "user-1",
      email: "user@example.com",
      roles: ["consumer"],
      isAdmin: false,
    };
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(403);
    expect(captured.fromCalls).toEqual([]);
  });

  it("A3 email invalide → 400, sortie avant tout I/O", async () => {
    const res = await POST(makeRequest({ email: "not-an-email" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    expect(captured.fromCalls).toEqual([]);
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });
});

// --- B. Cas 4 — admin existant -------------------------------------------

describe("B. Cas 4 — admin existant", () => {
  it("B1 email matche admin_users → 409 message dédié + kind, pas d'invitation envoyée", async () => {
    pushResp("admin_users", "select", { data: { id: "admin-9" }, error: null });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(409);
    // T-105 : `kind` ajouté pour permettre à l'UI admin de différencier les
    // 2 cas blocked sans regex sur le message texte.
    expect(await res.json()).toEqual({
      error: "Impossible d'inviter un administrateur comme producteur",
      kind: "blocked_admin",
    });
    expect(captured.fromCalls).toEqual(["admin_users"]);
    expect(mockSendTemplate).not.toHaveBeenCalled();
    expect(captured.inserts).toEqual([]);
  });
});

// --- C. Cas 3 — producer existant (variantes statut) ---------------------

describe("C. Cas 3 — producer existant", () => {
  function setupProducerWithStatut(statut: string) {
    pushResp("admin_users", "select", { data: null, error: null });
    pushResp("users", "select", {
      data: { id: "user-1", roles: ["consumer", "producer"] },
      error: null,
    });
    pushResp("producers", "select", { data: { statut }, error: null });
  }

  it.each([
    ["pending", "C1"],
    ["active", "C2"],
    ["public", "C3"],
    ["suspended", "C4"],
    ["deleted", "C5"],
  ])(
    "%s → 409 dur 'Ce producteur est déjà inscrit' + kind + statut, pas d'invitation [%s]",
    async (statut) => {
      setupProducerWithStatut(statut);
      const res = await POST(makeRequest(VALID_BODY));
      expect(res.status).toBe(409);
      // T-105 : `kind` + `statut` exposés pour message UX contextuel.
      expect(await res.json()).toEqual({
        error: "Ce producteur est déjà inscrit",
        kind: "blocked_producer",
        statut,
      });
      expect(captured.fromCalls).toEqual(["admin_users", "users", "producers"]);
      expect(mockSendTemplate).not.toHaveBeenCalled();
      expect(captured.inserts).toEqual([]);
    },
  );

  it("C6 producer.statut='draft' SANS confirm → 409 + kind='draft_resend_confirm_required', pas d'invitation envoyée", async () => {
    setupProducerWithStatut("draft");
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.kind).toBe("draft_resend_confirm_required");
    expect(body.error).toMatch(/onboarding producteur abandonné/i);
    expect(mockSendTemplate).not.toHaveBeenCalled();
    expect(captured.inserts).toEqual([]);
  });

  it("C7 producer.statut='draft' AVEC confirm_draft_resend=true → 200 + draft_resend=true, nouvelle invitation envoyée", async () => {
    setupProducerWithStatut("draft");
    const res = await POST(
      makeRequest({ ...VALID_BODY, confirm_draft_resend: true }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.draft_resend).toBe(true);
    expect(body.email_sent).toBe(true);
    expect(body.url).toContain("/invitation?token=tok-test");
    // Producer trouvé donc pas de bump/create lead pour ce flow draft_resend
    // (un user en draft a déjà eu son lead bump à la 1re invitation).
    // L'admin invite un email déjà connu : producer_interests UPDATE peut
    // tenter de bumper (gaté sur emailResult.ok). On accepte le bump comme
    // no-op (lead.statut!='new' → 0 row affected en réel ; ici default mock
    // simule 1 row, on ne le testera pas).
    expect(mockSendTemplate).toHaveBeenCalledOnce();
    // Insert producer_invitations ET PAS users/producers (pas de creation
    // de compte en draft_resend, juste un nouveau token).
    const insertTables = captured.inserts.map((i) => i.table);
    expect(insertTables).toContain("producer_invitations");
    expect(insertTables).not.toContain("users");
    expect(insertTables).not.toContain("producers");
  });
});

// --- D. Cas 2 — consumer existant (pas producer) -------------------------

describe("D. Cas 2 — consumer existant", () => {
  it("D1 roles=['consumer'] → 200 + invitation envoyée (upgrade délégué à /invitation page)", async () => {
    pushResp("admin_users", "select", { data: null, error: null });
    pushResp("users", "select", {
      data: { id: "user-1", roles: ["consumer"] },
      error: null,
    });
    // Pas de roles=['producer'] → pas de check producers, pas de 409.
    // Lead bump succède (default mock = 1 row 'new' bumpée).
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.draft_resend).toBe(false);
    expect(body.email_sent).toBe(true);
    expect(captured.fromCalls).not.toContain("producers");
    expect(mockSendTemplate).toHaveBeenCalledOnce();
    expect(
      captured.inserts.some((i) => i.table === "producer_invitations"),
    ).toBe(true);
  });
});

// --- E. Cas 1 — lead / prospect direct -----------------------------------

describe("E. Cas 1 — lead matching et création invitation_directe", () => {
  it("E1 lead 'new' matché → 200 + lead_updated=1, lead_created=false (skip création)", async () => {
    pushResp("admin_users", "select", { data: null, error: null });
    pushResp("users", "select", { data: null, error: null });
    pushResp("producer_interests", "update", {
      data: [{ id: "lead-1" }],
      error: null,
    });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lead_updated).toBe(1);
    expect(body.lead_created).toBe(false);
    expect(body.draft_resend).toBe(false);
    // Match ilike sur producer_interests.email
    expect(
      captured.ilikeCalls.find(
        (c) => c.table === "producer_interests" && c.col === "email",
      ),
    ).toBeTruthy();
    // Aucun INSERT producer_interests (le bump a matché → skip création)
    expect(
      captured.inserts.some((i) => i.table === "producer_interests"),
    ).toBe(false);
    // T-322 : metadata Resend ne doit PAS contenir token_prefix (leak audit
    // log forensique vers système tiers). token_prefix reste côté audit_logs
    // Supabase via logAuthEvent (cf. test H1 invitation_created).
    const sendArgs = mockSendTemplate.mock.calls[0]?.[0] as
      | { metadata?: Record<string, unknown> }
      | undefined;
    expect(sendArgs?.metadata).toBeDefined();
    expect(sendArgs?.metadata).not.toHaveProperty("token_prefix");
    expect(sendArgs?.metadata?.email).toBe("prospect@example.com");
  });

  it("E2 aucun lead matché ET aucun lead existant → 200 + lead_created=true (invitation_directe)", async () => {
    pushResp("admin_users", "select", { data: null, error: null });
    pushResp("users", "select", { data: null, error: null });
    // Bump : 0 row affected (aucun lead 'new' matché)
    pushResp("producer_interests", "update", { data: [], error: null });
    // Check existingLead : null (aucun lead tous statuts)
    pushResp("producer_interests", "select", { data: null, error: null });
    // INSERT : succès
    pushResp("producer_interests", "insert", { data: null, error: null });
    const res = await POST(
      makeRequest({ ...VALID_BODY, prenom: "Julien", nom: "Dupont" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lead_updated).toBe(0);
    expect(body.lead_created).toBe(true);
    const leadInsert = captured.inserts.find(
      (i) => i.table === "producer_interests",
    );
    expect(leadInsert).toBeTruthy();
    const payload = leadInsert!.payload as Record<string, unknown>;
    expect(payload.source).toBe("invitation_directe");
    expect(payload.statut).toBe("contacted");
    expect(payload.nom).toBe("Dupont");
  });

  it("E3 aucun lead matché MAIS lead existant ('contacted' déjà) → 200 + lead_created=false (skip création)", async () => {
    pushResp("admin_users", "select", { data: null, error: null });
    pushResp("users", "select", { data: null, error: null });
    pushResp("producer_interests", "update", { data: [], error: null });
    // existingLead found (lead 'contacted' déjà présent) → skip insert
    pushResp("producer_interests", "select", {
      data: { id: "lead-existing" },
      error: null,
    });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lead_updated).toBe(0);
    expect(body.lead_created).toBe(false);
    // Pas d'INSERT producer_interests
    expect(
      captured.inserts.some((i) => i.table === "producer_interests"),
    ).toBe(false);
  });

  it("E4 fallback nom = local-part de l'email quand input.nom absent", async () => {
    pushResp("admin_users", "select", { data: null, error: null });
    pushResp("users", "select", { data: null, error: null });
    pushResp("producer_interests", "update", { data: [], error: null });
    pushResp("producer_interests", "select", { data: null, error: null });
    pushResp("producer_interests", "insert", { data: null, error: null });
    const res = await POST(makeRequest({ email: "julien.dupont@example.com" }));
    expect(res.status).toBe(200);
    const leadInsert = captured.inserts.find(
      (i) => i.table === "producer_interests",
    );
    expect((leadInsert!.payload as { nom: string }).nom).toBe("julien.dupont");
  });
});

// --- F. Edge cases -------------------------------------------------------

describe("F. Edge cases", () => {
  it("F1 email_send_fail → 200 email_sent=false, pas de bump lead, pas de création lead", async () => {
    pushResp("admin_users", "select", { data: null, error: null });
    pushResp("users", "select", { data: null, error: null });
    mockSendTemplate.mockResolvedValue({ ok: false, error: "smtp down" });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.email_sent).toBe(false);
    expect(body.email_error).toBe("smtp down");
    expect(body.lead_updated).toBe(0);
    expect(body.lead_created).toBe(false);
    // Aucun UPDATE/INSERT producer_interests : tout est gaté sur emailResult.ok
    expect(
      captured.updates.some((u) => u.table === "producer_interests"),
    ).toBe(false);
    expect(
      captured.inserts.some((i) => i.table === "producer_interests"),
    ).toBe(false);
  });

  it("F2 producer_invitations INSERT échoue → 500 propre, pas d'email envoyé", async () => {
    pushResp("admin_users", "select", { data: null, error: null });
    pushResp("users", "select", { data: null, error: null });
    pushResp("producer_invitations", "insert", {
      data: null,
      error: { message: "constraint violation" },
    });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "constraint violation" });
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });

  it("F3 sendTemplate throw → catch + 200 email_sent=false (ceinture+bretelles)", async () => {
    pushResp("admin_users", "select", { data: null, error: null });
    pushResp("users", "select", { data: null, error: null });
    mockSendTemplate.mockRejectedValue(new Error("unexpected throw"));
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.email_sent).toBe(false);
    expect(body.email_error).toBe("unexpected throw");
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });
});

// --- G. UX admin enrichie — flag existing_account ------------------------
// Permet à l'UI admin de distinguer un consumer pré-existant (toast info
// upgrade-rôles) d'un prospect direct/lead (toast succès classique).
// Note : cas draft_resend (roles=['consumer','producer']) → null car le
// compte est déjà producer côté roles, pas de toast info nécessaire.

describe("G. existing_account flag", () => {
  it("G1 prospect direct (pas de users row) → existing_account=null", async () => {
    pushResp("admin_users", "select", { data: null, error: null });
    pushResp("users", "select", { data: null, error: null });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.existing_account).toBeNull();
  });

  it("G2 consumer existant (roles=['consumer']) → existing_account='consumer'", async () => {
    pushResp("admin_users", "select", { data: null, error: null });
    pushResp("users", "select", {
      data: { id: "user-1", roles: ["consumer"] },
      error: null,
    });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.existing_account).toBe("consumer");
  });
});

// --- H. T-310 : audit log forensique invitation_created ------------------
// L'event est émis dès l'INSERT producer_invitations OK (avant l'envoi
// email) pour ne pas perdre la trace si l'email échoue. userId = admin
// créateur, metadata embarque invitation_id + email cible + token_prefix.
// Pre-checks (403/400/409 admin/producer) → pas d'event car pas d'INSERT.

describe("H. T-310 audit log invitation_created", () => {
  it("H1 happy path (prospect direct) → logAuthEvent('invitation_created') avec invitation_id + email + token_prefix", async () => {
    pushResp("admin_users", "select", { data: null, error: null });
    pushResp("users", "select", { data: null, error: null });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    // T-081 : sur happy path, 2 events au total (invitation_created + admin_invite_sent
    // post-sendTemplate succès). Assertion ciblée sur le call invitation_created
    // pour rester compatible avec T-081 sans dupliquer la vérification du sent
    // (couvert par describe J ci-dessous).
    expect(logAuthEvent).toHaveBeenCalledWith({
      eventType: "invitation_created",
      userId: "admin-1",
      metadata: {
        invitation_id: "inv-test",
        invitation_email: "prospect@example.com",
        token_prefix: expect.stringMatching(/^[a-f0-9]{8}$/),
      },
    });
    const createdCalls = vi
      .mocked(logAuthEvent)
      .mock.calls.filter(
        (c) =>
          (c[0] as { eventType: string }).eventType === "invitation_created",
      );
    expect(createdCalls).toHaveLength(1);
  });

  it("H2 insert producer_invitations échoue → 500 + logAuthEvent JAMAIS appelé", async () => {
    pushResp("admin_users", "select", { data: null, error: null });
    pushResp("users", "select", { data: null, error: null });
    pushResp("producer_invitations", "insert", {
      data: null,
      error: { message: "constraint violation" },
    });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(500);
    expect(logAuthEvent).not.toHaveBeenCalled();
  });

  it("H3 email échoue mais INSERT OK → logAuthEvent appelé quand même (event indépendant email)", async () => {
    pushResp("admin_users", "select", { data: null, error: null });
    pushResp("users", "select", { data: null, error: null });
    mockSendTemplate.mockResolvedValue({ ok: false, error: "smtp down" });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    expect((await res.json()).email_sent).toBe(false);
    // L'invitation existe bien en DB, l'admin l'a bien créée → event émis.
    expect(logAuthEvent).toHaveBeenCalledTimes(1);
    expect(logAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "invitation_created" }),
    );
  });

  it("H4 pre-check 403 (session non-admin) → logAuthEvent JAMAIS appelé", async () => {
    sessionUser = {
      id: "user-1",
      email: "user@example.com",
      roles: ["consumer"],
      isAdmin: false,
    };
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(403);
    expect(logAuthEvent).not.toHaveBeenCalled();
  });

  it("H5 pre-check 409 (admin existant) → invitation_created JAMAIS appelé (l'admin_invite_blocked_admin émis est testé en J4)", async () => {
    pushResp("admin_users", "select", { data: { id: "admin-9" }, error: null });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(409);
    // T-081 : le 409 émet désormais admin_invite_blocked_admin (cf. J4),
    // mais invitation_created reste exclu (le bail-out 409 sort avant l'INSERT).
    expect(logAuthEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "invitation_created" }),
    );
  });
});

// --- I. T-109 : invalidation auto des invitations actives ----------------
// Avant l'INSERT du nouveau token, UPDATE producer_invitations SET
// expires_at=now() WHERE ilike(email, input.email) AND used_at IS NULL AND
// expires_at > now() RETURNING id. Pour chaque row bumpée, logAuthEvent
// 'invitation_revoked' (cohérent T-310 forensic, 1 event = 1 entité), avec
// metadata.replaced_by_invitation_id pour reconstituer la chaîne sur un
// même email lors d'une analyse forensique.
//
// Ordre critique : revoke AVANT INSERT — sinon la WHERE matcherait aussi
// la nouvelle row qu'on vient de créer. Tests I4/I5 vérifient les filtres
// de la WHERE clause (used_at null + expires_at > now()).

describe("I. T-109 invalidation auto des invitations actives", () => {
  it("I1 0 invits actives (data:[]) → UPDATE tenté, aucun event invitation_revoked, invitation_created OK", async () => {
    pushResp("admin_users", "select", { data: null, error: null });
    pushResp("users", "select", { data: null, error: null });
    // Default producer_invitations update = data:[] — no-op revoke.
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    // Le UPDATE est tenté (Postgres ne sait pas a priori si la WHERE matchera).
    expect(
      captured.updates.some((u) => u.table === "producer_invitations"),
    ).toBe(true);
    // Aucun event invitation_revoked émis.
    const revokedCalls = vi
      .mocked(logAuthEvent)
      .mock.calls.filter(
        (c) =>
          (c[0] as { eventType: string }).eventType === "invitation_revoked",
      );
    expect(revokedCalls).toHaveLength(0);
    // Sanity : invitation_created bien émis (pas de régression H).
    expect(logAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "invitation_created" }),
    );
  });

  it("I2 1 invit active → UPDATE bump expires_at + 1 event invitation_revoked metadata complet", async () => {
    pushResp("admin_users", "select", { data: null, error: null });
    pushResp("users", "select", { data: null, error: null });
    pushResp("producer_invitations", "update", {
      data: [{ id: "old-inv-1" }],
      error: null,
    });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    // Le UPDATE porte expires_at=now() au format ISO.
    const piUpdate = captured.updates.find(
      (u) => u.table === "producer_invitations",
    );
    expect(piUpdate).toBeTruthy();
    const payload = piUpdate!.payload as { expires_at: string };
    expect(payload.expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Event invitation_revoked émis avec metadata complet : revoked_invitation_id
    // (id de l'ancienne) + replaced_by_invitation_id (id de la nouvelle, "inv-test"
    // depuis defaultResp INSERT) + email masqué (RGPD).
    expect(logAuthEvent).toHaveBeenCalledWith({
      eventType: "invitation_revoked",
      userId: "admin-1",
      metadata: {
        revoked_invitation_id: "old-inv-1",
        replaced_by_invitation_id: "inv-test",
        email: expect.stringContaining("***"),
      },
    });
  });

  it("I3 2 invits actives → 2 events invitation_revoked distincts (1 event = 1 entité, pattern T-310)", async () => {
    pushResp("admin_users", "select", { data: null, error: null });
    pushResp("users", "select", { data: null, error: null });
    pushResp("producer_invitations", "update", {
      data: [{ id: "old-inv-1" }, { id: "old-inv-2" }],
      error: null,
    });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const revokedCalls = vi
      .mocked(logAuthEvent)
      .mock.calls.filter(
        (c) =>
          (c[0] as { eventType: string }).eventType === "invitation_revoked",
      );
    expect(revokedCalls).toHaveLength(2);
    expect(revokedCalls[0]?.[0]).toMatchObject({
      eventType: "invitation_revoked",
      metadata: { revoked_invitation_id: "old-inv-1" },
    });
    expect(revokedCalls[1]?.[0]).toMatchObject({
      eventType: "invitation_revoked",
      metadata: { revoked_invitation_id: "old-inv-2" },
    });
  });

  it("I4 chaîne WHERE inclut .is('used_at', null) — exclut invitations consommées (used_at non null)", async () => {
    pushResp("admin_users", "select", { data: null, error: null });
    pushResp("users", "select", { data: null, error: null });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    // Filtre .is sur producer_invitations.used_at = null. Garantit que le
    // SQL filtre les invitations déjà consommées (used_at IS NOT NULL).
    expect(captured.isCalls).toContainEqual({
      table: "producer_invitations",
      col: "used_at",
      val: null,
    });
  });

  it("I5 chaîne WHERE inclut .gt('expires_at', now) — exclut invitations déjà expirées", async () => {
    pushResp("admin_users", "select", { data: null, error: null });
    pushResp("users", "select", { data: null, error: null });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    // Filtre .gt sur producer_invitations.expires_at > maintenant. Garantit
    // que le SQL ne re-bumpe pas des invitations déjà expirées (les laisse
    // expirées au lieu de les "revoquer" une 2e fois — sémantique propre).
    const gtCall = captured.gtCalls.find(
      (c) => c.table === "producer_invitations" && c.col === "expires_at",
    );
    expect(gtCall).toBeTruthy();
    expect(gtCall!.val).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("I6 matching .ilike sur producer_invitations.email (case-insensitive Foo@... ↔ foo@...) — cohérent T-110", async () => {
    pushResp("admin_users", "select", { data: null, error: null });
    pushResp("users", "select", { data: null, error: null });
    const res = await POST(makeRequest({ email: "Foo@Example.COM" }));
    expect(res.status).toBe(200);
    // .ilike utilisé (et pas .eq) sur producer_invitations.email pour matcher
    // "Foo@Example.COM" en base avec une row stockée "foo@example.com".
    expect(captured.ilikeCalls).toContainEqual({
      table: "producer_invitations",
      col: "email",
      val: "Foo@Example.COM",
    });
    // Garde-fou : aucun .eq sur producer_invitations.email (sensible casse).
    expect(
      captured.eqCalls.find(
        (c) => c.table === "producer_invitations" && c.col === "email",
      ),
    ).toBeUndefined();
  });

  it("I8 T-110 lookup users.email via .ilike (case-insensitive) — input 'Bob@...' matche row stockée 'bob@...'", async () => {
    // Pré-check users (consumer existant) doit utiliser .ilike pour qu'un
    // admin saisissant 'Bob@Example.COM' tombe bien sur 'bob@example.com'.
    pushResp("admin_users", "select", { data: null, error: null });
    pushResp("users", "select", {
      data: { id: "user-1", roles: ["consumer"] },
      error: null,
    });
    const res = await POST(makeRequest({ email: "Bob@Example.COM" }));
    expect(res.status).toBe(200);
    expect(captured.ilikeCalls).toContainEqual({
      table: "users",
      col: "email",
      val: "Bob@Example.COM",
    });
    // Garde-fou : aucun .eq sur users.email (sensible casse).
    expect(
      captured.eqCalls.find(
        (c) => c.table === "users" && c.col === "email",
      ),
    ).toBeUndefined();
  });

  it("I9 T-110 lookup admin_users.email via .ilike (case-insensitive) — input 'ADMIN@...' matche row stockée 'admin@...'", async () => {
    // Pré-check admin_users doit utiliser .ilike : si admin déjà inscrit
    // sous 'admin@x.fr' et qu'un opérateur tape 'ADMIN@X.FR', le 409 doit
    // bien se déclencher (sinon on enverrait une invitation à un admin).
    pushResp("admin_users", "select", { data: { id: "admin-9" }, error: null });
    const res = await POST(makeRequest({ email: "ADMIN@Example.COM" }));
    expect(res.status).toBe(409);
    expect(captured.ilikeCalls).toContainEqual({
      table: "admin_users",
      col: "email",
      val: "ADMIN@Example.COM",
    });
    expect(
      captured.eqCalls.find(
        (c) => c.table === "admin_users" && c.col === "email",
      ),
    ).toBeUndefined();
  });

  it("I7 revoke UPDATE échoue (DB error) → console.warn [INVITATION_REVOKE_WARN], INSERT du nouveau token continue (fail-open)", async () => {
    pushResp("admin_users", "select", { data: null, error: null });
    pushResp("users", "select", { data: null, error: null });
    pushResp("producer_invitations", "update", {
      data: null,
      error: { message: "RLS policy violation" },
    });
    const res = await POST(makeRequest(VALID_BODY));
    // Pas de 500 : revoke fail-open, on continue avec l'INSERT.
    expect(res.status).toBe(200);
    expect(consoleWarnSpy).toHaveBeenCalled();
    const warned = consoleWarnSpy.mock.calls.find((c: unknown[]) =>
      String(c[0] ?? "").includes("[INVITATION_REVOKE_WARN]"),
    );
    expect(warned).toBeDefined();
    expect(String(warned?.[0] ?? "")).toContain("RLS policy violation");
    // Aucun event invitation_revoked (la WHERE est censée renvoyer 0 rows
    // après une DB error, donc aucun id à logger).
    const revokedCalls = vi
      .mocked(logAuthEvent)
      .mock.calls.filter(
        (c) =>
          (c[0] as { eventType: string }).eventType === "invitation_revoked",
      );
    expect(revokedCalls).toHaveLength(0);
    // Mais invitation_created bien émis (l'INSERT a continué).
    expect(logAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "invitation_created" }),
    );
  });
});

// --- J. T-081 audit log cluster admin_invite_* ---------------------------
// Quatre events posés par cette route :
//   - admin_invite_sent           : transport email OK (envoi initial).
//   - admin_invite_draft_resend   : transport email OK (relance d'un
//                                    onboarding producer abandonné).
//                                    Mutuellement exclusif avec sent.
//   - admin_invite_blocked_admin  : 409 pré-check email = admin existant.
//   - admin_invite_blocked_producer : 409 pré-check email = producteur
//                                     déjà inscrit (statut hors 'draft').
// Le 409 'draft_resend_confirm_required' n'émet PAS d'event (J6 ci-dessous).
// L'event admin_invite_expired est posé côté server actions producer/* —
// tests dédiés dans tests/app/(producer)/invitation/_actions/.

describe("J. T-081 audit log cluster admin_invite_*", () => {
  it("J1 happy path (prospect direct, email OK) → logAuthEvent('admin_invite_sent') avec invitation_id + invitation_email + resend_id", async () => {
    pushResp("admin_users", "select", { data: null, error: null });
    pushResp("users", "select", { data: null, error: null });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const sentCall = vi
      .mocked(logAuthEvent)
      .mock.calls.find(
        (c) =>
          (c[0] as { eventType: string }).eventType === "admin_invite_sent",
      );
    expect(sentCall).toBeDefined();
    expect(sentCall![0]).toEqual({
      eventType: "admin_invite_sent",
      userId: "admin-1",
      metadata: {
        invitation_id: "inv-test",
        invitation_email: "prospect@example.com",
        resend_id: "res_1",
      },
    });
    // Garde-fou : pas de admin_invite_draft_resend en parallèle (mutuellement
    // exclusifs — ce flow n'est pas un draft resend).
    const draftCalls = vi
      .mocked(logAuthEvent)
      .mock.calls.filter(
        (c) =>
          (c[0] as { eventType: string }).eventType ===
          "admin_invite_draft_resend",
      );
    expect(draftCalls).toHaveLength(0);
  });

  it("J2 draft_resend (producer.statut='draft' + confirm) → logAuthEvent('admin_invite_draft_resend'), PAS admin_invite_sent", async () => {
    pushResp("admin_users", "select", { data: null, error: null });
    pushResp("users", "select", {
      data: { id: "user-1", roles: ["consumer", "producer"] },
      error: null,
    });
    pushResp("producers", "select", { data: { statut: "draft" }, error: null });
    const res = await POST(
      makeRequest({ ...VALID_BODY, confirm_draft_resend: true }),
    );
    expect(res.status).toBe(200);
    const draftCall = vi
      .mocked(logAuthEvent)
      .mock.calls.find(
        (c) =>
          (c[0] as { eventType: string }).eventType ===
          "admin_invite_draft_resend",
      );
    expect(draftCall).toBeDefined();
    // Strict equality (toEqual) sur le payload complet — pas toMatchObject :
    // si un champ est ajouté/retiré/renommé silencieusement par le helper
    // logAdminInviteEvent, le test casse au lieu de tolérer la dérive.
    expect(draftCall![0]).toEqual({
      eventType: "admin_invite_draft_resend",
      userId: "admin-1",
      metadata: {
        invitation_id: "inv-test",
        invitation_email: "prospect@example.com",
        resend_id: "res_1",
      },
    });
    const sentCalls = vi
      .mocked(logAuthEvent)
      .mock.calls.filter(
        (c) =>
          (c[0] as { eventType: string }).eventType === "admin_invite_sent",
      );
    expect(sentCalls).toHaveLength(0);
  });

  it("J3 sendTemplate échoue (ok:false) → ni admin_invite_sent ni admin_invite_draft_resend (gating emailResult.ok)", async () => {
    pushResp("admin_users", "select", { data: null, error: null });
    pushResp("users", "select", { data: null, error: null });
    mockSendTemplate.mockResolvedValue({ ok: false, error: "smtp down" });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const transportCalls = vi
      .mocked(logAuthEvent)
      .mock.calls.filter((c) =>
        ["admin_invite_sent", "admin_invite_draft_resend"].includes(
          (c[0] as { eventType: string }).eventType,
        ),
      );
    expect(transportCalls).toHaveLength(0);
    // Sanity : invitation_created bien émis (l'INSERT DB a réussi, l'event
    // "DB" est indépendant de l'event "transport").
    expect(logAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "invitation_created" }),
    );
  });

  it("J4 409 admin existant → logAuthEvent('admin_invite_blocked_admin') avec invitation_email", async () => {
    pushResp("admin_users", "select", { data: { id: "admin-9" }, error: null });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(409);
    expect(logAuthEvent).toHaveBeenCalledTimes(1);
    expect(logAuthEvent).toHaveBeenCalledWith({
      eventType: "admin_invite_blocked_admin",
      userId: "admin-1",
      metadata: { invitation_email: "prospect@example.com" },
    });
    // invitation_created JAMAIS émis (le 409 sort avant l'INSERT).
    expect(logAuthEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "invitation_created" }),
    );
  });

  it.each([["pending"], ["active"], ["public"], ["suspended"], ["deleted"]])(
    "J5 409 producer.statut=%s → logAuthEvent('admin_invite_blocked_producer') avec statut",
    async (statut) => {
      pushResp("admin_users", "select", { data: null, error: null });
      pushResp("users", "select", {
        data: { id: "user-1", roles: ["consumer", "producer"] },
        error: null,
      });
      pushResp("producers", "select", { data: { statut }, error: null });
      const res = await POST(makeRequest(VALID_BODY));
      expect(res.status).toBe(409);
      expect(logAuthEvent).toHaveBeenCalledTimes(1);
      expect(logAuthEvent).toHaveBeenCalledWith({
        eventType: "admin_invite_blocked_producer",
        userId: "admin-1",
        metadata: {
          invitation_email: "prospect@example.com",
          statut,
        },
      });
      expect(logAuthEvent).not.toHaveBeenCalledWith(
        expect.objectContaining({ eventType: "invitation_created" }),
      );
    },
  );

  it("J6 409 draft_resend_confirm_required (sans confirm) → AUCUN event admin_invite_* (pas un blocage strict)", async () => {
    pushResp("admin_users", "select", { data: null, error: null });
    pushResp("users", "select", {
      data: { id: "user-1", roles: ["consumer", "producer"] },
      error: null,
    });
    pushResp("producers", "select", { data: { statut: "draft" }, error: null });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(409);
    expect((await res.json()).kind).toBe("draft_resend_confirm_required");
    // Pas d'event admin_invite_blocked_* : c'est une demande de confirmation
    // UX, pas un blocage forensiquement notable. Le 2e POST (avec confirm)
    // émettra alors admin_invite_draft_resend (cf. J2).
    const adminInviteCalls = vi
      .mocked(logAuthEvent)
      .mock.calls.filter((c) =>
        (c[0] as { eventType: string }).eventType.startsWith("admin_invite_"),
      );
    expect(adminInviteCalls).toHaveLength(0);
  });
});
