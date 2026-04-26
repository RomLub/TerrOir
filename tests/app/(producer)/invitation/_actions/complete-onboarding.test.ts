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
      builder.maybeSingle = () => Promise.resolve(resp);
      builder.then = (onFulfilled: (r: Resp) => unknown) => onFulfilled(resp);
      return builder;
    },
  }),
}));

// Import APRÈS les mocks (vi.mock est hoisté par vitest, mais on garde
// l'ordre lisible). Le path alias `@` → repo root est défini dans
// vitest.config.ts.
import { completeOnboardingAction } from "@/app/(producer)/invitation/_actions/complete-onboarding";

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
