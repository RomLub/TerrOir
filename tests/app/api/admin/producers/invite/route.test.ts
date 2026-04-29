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
  process.env.OPT_OUT_TOKEN_SECRET =
    process.env.OPT_OUT_TOKEN_SECRET ?? "test-opt-out-secret";
});

// `server-only` est importé par lib/rgpd/opt-out-token et lib/auth/session
// (chargés transitivement par la route). Stub-out en environnement test.
vi.mock("server-only", () => ({}));

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
  //   - producer_invitations INSERT : succès, RETURNING token+expires_at
  //   - producer_interests UPDATE : 1 row bumpée (lead 'new' matché)
  if (op === "update" || op === "insert") {
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
    if (table === "producer_interests" && op === "update") {
      return { data: [{ id: "lead-1" }], error: null };
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
  it("B1 email matche admin_users → 409 message dédié, pas d'invitation envoyée", async () => {
    pushResp("admin_users", "select", { data: { id: "admin-9" }, error: null });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "Impossible d'inviter un administrateur comme producteur",
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
    "%s → 409 dur 'Ce producteur est déjà inscrit', pas d'invitation [%s]",
    async (statut) => {
      setupProducerWithStatut(statut);
      const res = await POST(makeRequest(VALID_BODY));
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: "Ce producteur est déjà inscrit",
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
    expect(logAuthEvent).toHaveBeenCalledTimes(1);
    expect(logAuthEvent).toHaveBeenCalledWith({
      eventType: "invitation_created",
      userId: "admin-1",
      metadata: {
        invitation_id: "inv-test",
        invitation_email: "prospect@example.com",
        token_prefix: expect.stringMatching(/^[a-f0-9]{8}$/),
      },
    });
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

  it("H5 pre-check 409 (admin existant) → logAuthEvent JAMAIS appelé", async () => {
    pushResp("admin_users", "select", { data: { id: "admin-9" }, error: null });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(409);
    expect(logAuthEvent).not.toHaveBeenCalled();
  });
});
