import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mocks I/O. La logique métier (validation, honeypot, rate-limit, convergence
// prospect, email existant, rollback) est testée contre des mocks injectés.
vi.mock("@/lib/env/urls", () => ({
  NEXT_PUBLIC_APP_URL: "https://www.test.fr",
  NEXT_PUBLIC_PRODUCER_URL: "https://pro.test.fr",
}));
vi.mock("next/headers", () => ({ headers: async () => new Map() }));
vi.mock("@/lib/legal/versions", () => ({ LEGAL_VERSIONS: { CGU: "v1" } }));
vi.mock("@/lib/producers/slug-from-email", () => ({
  slugFromEmail: (e: string) => `slug-${e}`,
}));

const h = vi.hoisted(() => ({
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  signIn: vi.fn(),
  maybeSingle: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  consume: vi.fn(),
  verifyPrefill: vi.fn(),
  upsert: vi.fn(),
  send: vi.fn(),
  optOut: vi.fn(),
  logAuth: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: () => h.maybeSingle(table) }) }),
      insert: (payload: unknown) => {
        const r = h.insert(table, payload);
        return Promise.resolve(r);
      },
      update: (payload: unknown) => ({
        eq: () => Promise.resolve(h.update(table, payload)),
      }),
    }),
    auth: { admin: { createUser: h.createUser, deleteUser: h.deleteUser } },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { signInWithPassword: h.signIn },
  }),
}));
vi.mock("@/lib/rate-limit", () => ({
  getProducerSignupRateLimit: () => ({}),
  consumeRateLimit: () => h.consume(),
}));
vi.mock("@/lib/audit-logs/log-auth-event", () => ({
  extractRequestContext: () => ({ ipAddress: "1.2.3.4" }),
  logAuthEvent: h.logAuth,
}));
vi.mock("@/lib/leads/prefill-token", () => ({ verifyPrefillToken: h.verifyPrefill }));
vi.mock("@/lib/producer-interests/upsert-interest", () => ({
  upsertProducerInterest: h.upsert,
}));
vi.mock("@/lib/resend/send", () => ({ sendTemplate: h.send }));
vi.mock("@/lib/rgpd/opt-out-token", () => ({ generateOptOutToken: h.optOut }));

import { signupProducerAction } from "@/app/(public)/devenir-producteur/_actions/signup-producer";

const PWD = "Pass1234abcd"; // 12 chars valides

function fd(overrides: Record<string, string | string[]> = {}): FormData {
  const f = new FormData();
  const base: Record<string, string> = {
    prenom: "Jean",
    nom: "Dupont",
    email: "jean@ferme.fr",
    password: PWD,
    passwordConfirm: PWD,
    telephone: "0600000000",
    nom_exploitation: "Ferme du Test",
    commune: "Le Mans",
    code_postal: "72000",
    message: "",
    prefillToken: "",
    cgu_accepted: "on",
    website: "",
  };
  for (const [k, v] of Object.entries(base)) f.set(k, v);
  for (const [k, v] of Object.entries(overrides)) {
    if (Array.isArray(v)) v.forEach((x) => f.append(k, x));
    else f.set(k, v);
  }
  return f;
}

beforeEach(() => {
  h.consume.mockReset().mockResolvedValue({ success: true, limit: 10, reset: 0 });
  h.createUser.mockReset().mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  h.deleteUser.mockReset().mockResolvedValue({ error: null });
  h.signIn.mockReset().mockResolvedValue({ error: null });
  h.maybeSingle.mockReset().mockResolvedValue({ data: null, error: null });
  h.insert.mockReset().mockReturnValue({ error: null });
  h.update.mockReset().mockReturnValue({ error: null });
  h.verifyPrefill.mockReset().mockReturnValue({ valid: false, expired: false });
  h.upsert.mockReset().mockResolvedValue({ ok: true, data: { id: "lead1", status: "created" } });
  h.send.mockReset().mockResolvedValue({ ok: true, id: "e1" });
  h.optOut.mockReset().mockReturnValue({ token: "opt", expiresAt: new Date() });
  h.logAuth.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("signupProducerAction", () => {
  it("body invalide (email manquant) → error, aucune création", async () => {
    const res = await signupProducerAction({}, fd({ email: "" }));
    expect(res.error).toBeTruthy();
    expect(h.createUser).not.toHaveBeenCalled();
  });

  it("password trop court (< 12) → error", async () => {
    const res = await signupProducerAction({}, fd({ password: "Short1", passwordConfirm: "Short1" }));
    expect(res.error).toMatch(/12 caractères/);
    expect(h.createUser).not.toHaveBeenCalled();
  });

  it("passwords différents → error", async () => {
    const res = await signupProducerAction({}, fd({ passwordConfirm: "AutreChose123" }));
    expect(res.error).toMatch(/ne correspondent pas/);
  });

  it("honeypot rempli → success neutre sans création", async () => {
    const res = await signupProducerAction({}, fd({ website: "bot" }));
    expect(res.success).toBe(true);
    expect(res.redirectTo).toBeUndefined();
    expect(h.createUser).not.toHaveBeenCalled();
  });

  it("rate-limit dépassé → error + audit rate_limit_exceeded", async () => {
    h.consume.mockResolvedValue({ success: false, limit: 10, reset: 0 });
    const res = await signupProducerAction({}, fd());
    expect(res.error).toMatch(/Trop de tentatives/);
    expect(h.createUser).not.toHaveBeenCalled();
    expect(h.logAuth.mock.calls[0][0].eventType).toBe("rate_limit_exceeded");
  });

  it("happy path spontané → compte + lead upsert + signin + welcome + success", async () => {
    const res = await signupProducerAction({}, fd({ especes: ["Bœuf", "Porc"] }));
    expect(res.success).toBe(true);
    expect(res.redirectTo).toBe("https://pro.test.fr/ma-page");
    expect(h.createUser).toHaveBeenCalledWith({
      email: "jean@ferme.fr",
      password: PWD,
      email_confirm: true,
    });
    // users + producers insérés
    const tables = h.insert.mock.calls.map((c) => c[0]);
    expect(tables).toContain("users");
    expect(tables).toContain("producers");
    // lead spontané via upsert (pas update)
    expect(h.upsert).toHaveBeenCalledOnce();
    expect(h.update).not.toHaveBeenCalled();
    expect(h.signIn).toHaveBeenCalled();
    expect(h.send.mock.calls[0][0].template).toBe("producer_welcome");
    expect(h.logAuth.mock.calls.some((c) => c[0].eventType === "account_signup")).toBe(true);
  });

  it("email déjà connu → accountExists + message clair, pas de profil créé", async () => {
    h.createUser.mockResolvedValue({ data: { user: null }, error: { code: "email_exists", message: "already exists" } });
    const res = await signupProducerAction({}, fd());
    expect(res.accountExists).toBe(true);
    expect(res.error).toMatch(/compte existe déjà/i);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("prospect (prefill valide) → email du lead forcé + update étape 4 (pas upsert)", async () => {
    h.verifyPrefill.mockReturnValue({ valid: true, leadId: "lead-9", expiresAt: new Date() });
    h.maybeSingle.mockResolvedValue({
      data: { id: "lead-9", email: "prospect@ferme.fr", prefill_token: "tok-abc" },
      error: null,
    });
    const res = await signupProducerAction({}, fd({ prefillToken: "tok-abc", email: "ignored@x.fr" }));
    expect(res.success).toBe(true);
    // email autoritaire = celui du lead (pas le champ form)
    expect(h.createUser.mock.calls[0][0].email).toBe("prospect@ferme.fr");
    // lead existant updaté à l'étape 4, pas d'upsert spontané
    expect(h.update).toHaveBeenCalled();
    const updateCall = h.update.mock.calls.find((c) => c[0] === "producer_interests");
    expect(updateCall?.[1]).toMatchObject({ current_step: 4 });
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("profil users échoue → rollback deleteUser + error", async () => {
    h.insert.mockImplementation((table: string) =>
      table === "users" ? { error: { message: "boom" } } : { error: null },
    );
    const res = await signupProducerAction({}, fd());
    expect(res.error).toMatch(/impossible/i);
    expect(h.deleteUser).toHaveBeenCalledWith("u1");
    expect(res.success).toBeUndefined();
  });
});
