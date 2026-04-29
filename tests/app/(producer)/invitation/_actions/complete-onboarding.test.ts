import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Mocks ---------------------------------------------------------------
// Le redirect Next.js réel throw NEXT_REDIRECT en succès. On stubbe avec un
// throw maison qu'on attrape dans le helper runAction() pour laisser les
// assertions s'exécuter.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  },
}));

// revalidatePath() requiert un static generation store en runtime — absent en
// test (env=node). Mock en no-op : la sémantique cache-bust n'a pas d'incidence
// sur les assertions métier de ce fichier (DB writes, redirect path, lead bump).
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

type SessionUser = {
  id: string;
  email: string | null;
  roles: string[];
  isAdmin: boolean;
};
let sessionUser: SessionUser | null;
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => sessionUser,
}));

// Mock Supabase admin : un builder chaînable par appel `from(table)`. Chaque
// méthode (.update/.eq/.ilike/.select) capture ses args et retourne le builder.
// `.maybeSingle()` résout en Promise ; le builder est aussi thenable pour les
// chaînes awaited directement (sans .maybeSingle) — pattern aligné sur
// tests/lib/stripe/sync-account-flags.test.ts.
type Resp = { data?: unknown; error?: unknown };

type Captured = {
  fromCalls: string[];
  updates: Array<{ table: string; payload: unknown }>;
  selects: Array<{ table: string; cols: string }>;
  eqCalls: Array<{ table: string; col: string; val: unknown }>;
  ilikeCalls: Array<{ table: string; col: string; val: unknown }>;
  isCalls: Array<{ table: string; col: string; val: unknown }>;
};

let captured: Captured;
let responses: Record<string, Resp[]>;

function defaultResp(table: string): Resp {
  // Defaults qui font passer le flow métier sans intervention. Les tests
  // surchargent uniquement `producer_interests` (la table sous test).
  if (table === "producers") return { data: { statut: "draft" }, error: null };
  return { data: null, error: null };
}

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      captured.fromCalls.push(table);
      const resp = responses[table]?.shift() ?? defaultResp(table);

      const builder: Record<string, unknown> = {};
      builder.update = (payload: unknown) => {
        captured.updates.push({ table, payload });
        return builder;
      };
      builder.select = (cols: string) => {
        captured.selects.push({ table, cols });
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
      builder.maybeSingle = () => Promise.resolve(resp);
      builder.then = (onFulfilled: (r: Resp) => unknown) => onFulfilled(resp);
      return builder;
    },
  }),
}));

// T-307 — mock logAuthEvent : la SUT l'appelle sur race lost. On veut
// vérifier eventType + payload metadata sans déclencher l'INSERT réel
// dans audit_logs (qui a son propre suite de tests dédiée).
vi.mock("@/lib/audit-logs/log-auth-event", () => ({
  logAuthEvent: vi.fn(),
}));

// Import APRÈS les mocks (vi.mock est hoisté par vitest, mais on garde
// l'ordre lisible). Le path alias `@` → repo root est défini dans
// vitest.config.ts.
import { completeOnboardingAction } from "@/app/(producer)/invitation/_actions/complete-onboarding";
import { logAuthEvent } from "@/lib/audit-logs/log-auth-event";

// --- Helpers --------------------------------------------------------------

function makeFormData(overrides: Record<string, string> = {}): FormData {
  // Token vide → branche "reprise d'onboarding" (Phase 4) : pas d'invitation
  // à valider, légitimité via session + producer draft existant. On évite
  // ainsi de mocker la chaîne producer_invitations + check email invitation.
  const fd = new FormData();
  fd.set("token", "");
  fd.set("prenom", "Jean");
  fd.set("nom", "Dupont");
  fd.set("telephone", "0612345678");
  fd.set("prenom_affichage", "Jean");
  fd.set("nom_exploitation", "Ferme du Test");
  fd.set("forme_juridique", "ei");
  fd.set("siret", "12345678901234");
  fd.set("adresse", "1 rue Test");
  fd.set("code_postal", "75001");
  fd.set("commune", "Paris");
  fd.set("type_production", "maraichage");
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

async function runAction(formData: FormData): Promise<{ error?: string } | undefined> {
  // Le redirect mocké throw __REDIRECT__ en chemin succès. On l'attrape
  // pour laisser les assertions s'exécuter ; toute autre erreur remonte.
  try {
    return await completeOnboardingAction({}, formData);
  } catch (e) {
    if (!String(e).includes("__REDIRECT__")) throw e;
    return undefined;
  }
}

// --- Setup / teardown -----------------------------------------------------

let consoleInfoSpy: ReturnType<typeof vi.spyOn>;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  captured = {
    fromCalls: [],
    updates: [],
    selects: [],
    eqCalls: [],
    ilikeCalls: [],
    isCalls: [],
  };
  responses = {};
  sessionUser = {
    id: "user-42",
    email: "user@example.com",
    roles: ["consumer"],
    isAdmin: false,
  };
  consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(logAuthEvent).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Tests ----------------------------------------------------------------

describe("completeOnboardingAction — auto-bump lead 'contacted' → 'onboarded'", () => {
  it("UPDATE producer_interests + log [LEAD_ONBOARDED] quand un lead 'contacted' match l'email session", async () => {
    responses.producer_interests = [{ data: [{ id: "lead-1" }], error: null }];

    await runAction(makeFormData());

    expect(captured.fromCalls).toContain("producer_interests");
    const piUpdates = captured.updates.filter((u) => u.table === "producer_interests");
    expect(piUpdates).toEqual([
      { table: "producer_interests", payload: { statut: "onboarded" } },
    ]);
    expect(captured.ilikeCalls).toContainEqual({
      table: "producer_interests",
      col: "email",
      val: "user@example.com",
    });
    expect(captured.eqCalls).toContainEqual({
      table: "producer_interests",
      col: "statut",
      val: "contacted",
    });
    expect(captured.selects).toContainEqual({
      table: "producer_interests",
      cols: "id",
    });

    expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
    const logged = String(consoleInfoSpy.mock.calls[0]?.[0] ?? "");
    expect(logged).toContain("[LEAD_ONBOARDED]");
    expect(logged).toContain("Bumped 1 lead");
    // Email masqué via maskEmail() — RGPD : "user@..." → "us***@..."
    expect(logged).toContain("us***@example.com");
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it("passe session.email verbatim à .ilike (case-insensitivity côté Supabase, pas de transformation client)", async () => {
    sessionUser = { ...sessionUser!, email: "User@Example.COM" };
    responses.producer_interests = [{ data: [{ id: "lead-2" }], error: null }];

    await runAction(makeFormData());

    expect(captured.ilikeCalls).toContainEqual({
      table: "producer_interests",
      col: "email",
      val: "User@Example.COM",
    });
    // Garde-fou : on n'utilise pas .eq("email", ...) (sensible à la casse).
    const eqEmail = captured.eqCalls.find(
      (e) => e.table === "producer_interests" && e.col === "email",
    );
    expect(eqEmail).toBeUndefined();
  });

  it("no-op silencieux si aucun lead ne match (data: []) — producer s'inscrit sans avoir été invité", async () => {
    responses.producer_interests = [{ data: [], error: null }];

    await runAction(makeFormData());

    // L'UPDATE est tenté (Supabase ne sait pas a priori si la WHERE matchera)
    expect(
      captured.updates.filter((u) => u.table === "producer_interests"),
    ).toHaveLength(1);
    // Mais ni info ni warn : c'est un cas légitime, pas un échec.
    expect(consoleInfoSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it("filtre .eq('statut', 'contacted') exclut les leads en 'new' (formulaire public, jamais invités)", async () => {
    // Côté SQL un lead 'new' renvoie data:[] car la WHERE l'exclut. On
    // simule ce comportement et on vérifie surtout que le filtre est bien
    // posé dans la chaîne — c'est le seul garde-fou contre le bump 'new' →
    // 'onboarded' qui sauterait le statut 'contacted'.
    responses.producer_interests = [{ data: [], error: null }];

    await runAction(makeFormData());

    expect(captured.eqCalls).toContainEqual({
      table: "producer_interests",
      col: "statut",
      val: "contacted",
    });
    expect(consoleInfoSpy).not.toHaveBeenCalled();
  });

  it("filtre .eq('statut', 'contacted') exclut aussi les leads en 'opted_out' (lead RGPD-désinscrit)", async () => {
    responses.producer_interests = [{ data: [], error: null }];

    await runAction(makeFormData());

    expect(captured.eqCalls).toContainEqual({
      table: "producer_interests",
      col: "statut",
      val: "contacted",
    });
    expect(consoleInfoSpy).not.toHaveBeenCalled();
  });

  it("log [LEAD_ONBOARDED_WARN] sur erreur Supabase, le flow métier ne re-throw pas", async () => {
    responses.producer_interests = [
      { data: null, error: { message: "RLS policy violation" } },
    ];

    // L'action doit toujours atteindre le redirect (qui throw __REDIRECT__).
    // runAction l'attrape → resolves(undefined). Si l'action avait re-throw
    // l'erreur DB, runAction la propagerait et le test échouerait.
    await expect(runAction(makeFormData())).resolves.toBeUndefined();

    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    const warned = String(consoleWarnSpy.mock.calls[0]?.[0] ?? "");
    expect(warned).toContain("[LEAD_ONBOARDED_WARN]");
    expect(warned).toContain("RLS policy violation");
    expect(warned).toContain("us***@example.com");
    expect(consoleInfoSpy).not.toHaveBeenCalled();
  });

  it("session.email null → ne tente jamais l'UPDATE producer_interests, aucun log", async () => {
    sessionUser = { ...sessionUser!, email: null };

    await runAction(makeFormData());

    expect(captured.fromCalls).not.toContain("producer_interests");
    expect(
      captured.updates.find((u) => u.table === "producer_interests"),
    ).toBeUndefined();
    expect(consoleInfoSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });
});

// --- T-307 : guard race condition consommation token --------------------
// Le UPDATE producer_invitations final porte un guard SQL .is('used_at',
// null) + .select('id') pour détecter le cas où une transaction concurrente
// a déjà claim le token entre le check ligne 54 et le UPDATE. Sémantique :
// data path users + producers étant idempotent, on log + audit + continue
// le redirect happy plutôt que rejeter — UX cohérente avec un onboarding
// en réalité réussi côté data.

function makeValidInvitationRead(): Resp {
  // SELECT initial sur producer_invitations dans la branche `if (token)` :
  // invitation valide non consommée, email matchant la session, expiration
  // largement future. Permet d'arriver au UPDATE final qui porte le guard.
  return {
    data: {
      id: "inv-99",
      email: "user@example.com",
      expires_at: "2030-12-31T00:00:00Z",
      used_at: null,
    },
    error: null,
  };
}

describe("completeOnboardingAction — race condition consommation token (T-307)", () => {
  it("happy path : claim succeeds → UPDATE invitation chaîne .is('used_at', null) + .select('id'), aucun log race + audit log invitation_consumed_success", async () => {
    responses.producer_invitations = [
      makeValidInvitationRead(),
      // 2e from() pour producer_invitations = UPDATE final → claim OK,
      // 1 row affected.
      { data: [{ id: "inv-99" }], error: null },
    ];

    await runAction(makeFormData({ token: "abcdef0123456789-token" }));

    // Le guard SQL est posé sur l'UPDATE.
    expect(captured.isCalls).toContainEqual({
      table: "producer_invitations",
      col: "used_at",
      val: null,
    });
    // Le rowcount est récupéré pour détecter la race.
    expect(captured.selects).toContainEqual({
      table: "producer_invitations",
      cols: "id",
    });

    // Aucun signal de race.
    const raceWarn = consoleWarnSpy.mock.calls.find((c: unknown[]) =>
      String(c[0] ?? "").includes("[INVITATION_RACE_LOST]"),
    );
    expect(raceWarn).toBeUndefined();
    expect(logAuthEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "invitation_consumed_race_lost" }),
    );

    // T-310 : audit log success path symétrique race_lost. Émis avec
    // préfixe token (8 chars), jamais le token complet.
    expect(logAuthEvent).toHaveBeenCalledWith({
      eventType: "invitation_consumed_success",
      userId: "user-42",
      metadata: {
        invitation_id: "inv-99",
        token_prefix: "abcdef01",
      },
    });
  });

  it("race lost : claim renvoie rowcount=0 → console.warn [INVITATION_RACE_LOST] + audit log invitation_consumed_race_lost, redirect happy quand même", async () => {
    responses.producer_invitations = [
      makeValidInvitationRead(),
      // Race : autre transaction a claim avant nous → 0 rows updated.
      { data: [], error: null },
    ];

    // runAction resolve undefined si le redirect happy a été déclenché
    // (le throw __REDIRECT__ est attrapé par runAction). Si la SUT avait
    // return error, runAction renverrait { error: ... } à la place.
    await expect(
      runAction(makeFormData({ token: "abcdef0123456789-token" })),
    ).resolves.toBeUndefined();

    const raceWarn = consoleWarnSpy.mock.calls.find((c: unknown[]) =>
      String(c[0] ?? "").includes("[INVITATION_RACE_LOST]"),
    );
    expect(raceWarn).toBeDefined();
    const warned = String(raceWarn?.[0] ?? "");
    expect(warned).toContain("invitationId=inv-99");
    expect(warned).toContain("userId=user-42");

    // Audit log race lost émis avec préfixe token (8 chars), jamais le
    // token complet (cohérent T-081 PR-A : token Resend metadata = prefix
    // only).
    expect(logAuthEvent).toHaveBeenCalledWith({
      eventType: "invitation_consumed_race_lost",
      userId: "user-42",
      metadata: {
        invitation_id: "inv-99",
        token_prefix: "abcdef01",
      },
    });
    // T-310 : exclusion mutuelle race_lost / consumed_success.
    expect(logAuthEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "invitation_consumed_success" }),
    );
  });

  it("claimError DB authentique → console.error [INVITATION_CLAIM_ERROR] + pas d'audit log race + redirect happy", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    responses.producer_invitations = [
      makeValidInvitationRead(),
      // Erreur DB pendant le UPDATE invitation : on log error mais on
      // continue (data path users + producers idempotent → pas un échec
      // critique du POV utilisateur). Distinct de la race (rowcount=0).
      { data: null, error: { message: "connection reset" } },
    ];

    await expect(
      runAction(makeFormData({ token: "abcdef0123456789-token" })),
    ).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[INVITATION_CLAIM_ERROR]"),
    );
    expect(logAuthEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "invitation_consumed_race_lost" }),
    );
    // T-310 : claimError n'est NI race lost NI success → aucun event T-310
    // émis (seul le console.error forensique trace l'incident DB).
    expect(logAuthEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "invitation_consumed_success" }),
    );
  });
});
