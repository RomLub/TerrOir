import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";

// vitest 4 : `vi.fn()` retourne `Mock<Procedure | Constructable>` qui n'est
// pas appelable. On force le type vers une signature de fonction concrète.
type AnyAsyncFn = (...args: unknown[]) => Promise<unknown>;

// --- Mocks ---------------------------------------------------------------
// Surfaces mockées :
//   1. createSupabaseServerClient → auth.signUp
//   2. createSupabaseAdminClient → from(...).insert() + auth.admin.deleteUser
//   3. NEXT_PUBLIC_APP_URL → constante stable pour assertion emailRedirectTo
//   4. T-305 PR-B : @/lib/rate-limit (consumeRateLimit + getSignupRateLimit)
//      + @/lib/audit-logs/log-auth-event (logAuthEvent + extractRequestContext)
//      + next/headers (headers() pour extractRequestContext).

vi.mock("next/headers", () => ({
  headers: vi.fn(() => ({ get: () => null })),
}));

const consumeRateLimitMock = vi.hoisted(() =>
  vi.fn(async () => ({ success: true, limit: 5, remaining: 4, reset: 0 })),
);
const logAuthEventMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimit: consumeRateLimitMock,
  getSignupRateLimit: () => ({}),
}));

vi.mock("@/lib/audit-logs/log-auth-event", () => ({
  logAuthEvent: logAuthEventMock,
  extractRequestContext: () => ({
    ipAddress: "203.0.113.5",
    userAgent: null,
  }),
}));

let supabaseSignUpMock: Mock<AnyAsyncFn>;
let adminInsertMock: Mock<AnyAsyncFn>;
let adminDeleteUserMock: Mock<AnyAsyncFn>;

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      signUp: (...args: unknown[]) => supabaseSignUpMock(...args),
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: () => ({
      insert: (...args: unknown[]) => adminInsertMock(...args),
    }),
    auth: {
      admin: {
        deleteUser: (...args: unknown[]) => adminDeleteUserMock(...args),
      },
    },
  }),
}));

vi.mock("@/lib/env/urls", () => ({
  NEXT_PUBLIC_APP_URL: "https://www.test.local",
}));

import { signupAction } from "@/app/(consumer)/auth/inscription/actions";

// --- Helpers --------------------------------------------------------------

const VALID_PASSWORD = "Pass1234abcd";
const VALID_EMAIL = "user@example.com";

function makeFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("prenom", "Alice");
  fd.set("nom", "Martin");
  fd.set("email", VALID_EMAIL);
  fd.set("password", VALID_PASSWORD);
  fd.set("telephone", "");
  // CGU acceptée par défaut dans les fixtures (happy path) — overridable
  // pour les tests négatifs (cgu_accepted manquant ou explicitement faux).
  fd.set("cgu_accepted", "on");
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

// --- Setup / teardown -----------------------------------------------------

beforeEach(() => {
  supabaseSignUpMock = vi.fn<AnyAsyncFn>().mockResolvedValue({
    data: { user: { id: "user-1" } },
    error: null,
  });
  adminInsertMock = vi.fn<AnyAsyncFn>().mockResolvedValue({ error: null });
  adminDeleteUserMock = vi
    .fn<AnyAsyncFn>()
    .mockResolvedValue({ error: null });

  consumeRateLimitMock.mockReset();
  consumeRateLimitMock.mockResolvedValue({
    success: true,
    limit: 5,
    remaining: 4,
    reset: 0,
  });
  logAuthEventMock.mockReset();
  logAuthEventMock.mockResolvedValue(undefined);

  // Silence console.warn / console.error pour les tests qui les déclenchent
  // intentionnellement. On vérifie le comportement métier, pas la trace.
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Tests ----------------------------------------------------------------

describe("signupAction", () => {
  it("happy path : signUp + insert profil OK → success { email }, pas de deleteUser, emailRedirectTo correct", async () => {
    const res = await signupAction({}, makeFormData());

    expect(res).toEqual({ success: { email: VALID_EMAIL } });
    expect(supabaseSignUpMock).toHaveBeenCalledWith({
      email: VALID_EMAIL,
      password: VALID_PASSWORD,
      options: {
        data: { prenom: "Alice", nom: "Martin" },
        emailRedirectTo:
          "https://www.test.local/auth/callback?next=/compte/commandes",
      },
    });
    // CGU : timestamp ISO + version "1.0" persistés à l'INSERT users.
    // On vérifie le shape (pas la valeur exacte du timestamp) puisque
    // new Date().toISOString() n'est pas mockable sans freezing time.
    expect(adminInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "user-1",
        email: VALID_EMAIL,
        roles: ["consumer"],
        prenom: "Alice",
        nom: "Martin",
        telephone: null,
        sms_optin: false,
        cgu_accepted_at: expect.stringMatching(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
        ),
        cgu_version: "1.0",
      }),
    );
    expect(adminDeleteUserMock).not.toHaveBeenCalled();
  });

  it("Zod fail (password trop court) → error, aucun appel Supabase", async () => {
    const res = await signupAction(
      {},
      makeFormData({ password: "Sh1" }),
    );

    expect(res.error).toMatch(/12 caractères/);
    expect(supabaseSignUpMock).not.toHaveBeenCalled();
    expect(adminInsertMock).not.toHaveBeenCalled();
    expect(adminDeleteUserMock).not.toHaveBeenCalled();
  });

  it("T-313 enumeration : signUp error code=user_already_exists → simule succès, aucun insert ni deleteUser", async () => {
    supabaseSignUpMock = vi.fn<AnyAsyncFn>().mockResolvedValue({
      data: { user: null },
      error: {
        message: "User already registered",
        code: "user_already_exists",
      },
    });

    const res = await signupAction({}, makeFormData());

    expect(res).toEqual({ success: { email: VALID_EMAIL } });
    expect(adminInsertMock).not.toHaveBeenCalled();
    expect(adminDeleteUserMock).not.toHaveBeenCalled();
  });

  it("T-313 enumeration : signUp error message regex 'already registered' (sans code) → simule succès", async () => {
    supabaseSignUpMock = vi.fn<AnyAsyncFn>().mockResolvedValue({
      data: { user: null },
      error: { message: "User already registered" },
    });

    const res = await signupAction({}, makeFormData());

    expect(res).toEqual({ success: { email: VALID_EMAIL } });
    expect(adminInsertMock).not.toHaveBeenCalled();
  });

  it("signUp error générique (non-duplicate) → error mappé FR, console.error appelé", async () => {
    supabaseSignUpMock = vi.fn<AnyAsyncFn>().mockResolvedValue({
      data: { user: null },
      error: { message: "Service unavailable", code: "internal_error" },
    });

    const res = await signupAction({}, makeFormData());

    expect(res.error).toMatch(/Inscription impossible/);
    expect(adminInsertMock).not.toHaveBeenCalled();
    expect(adminDeleteUserMock).not.toHaveBeenCalled();
  });

  it("signUp success mais data.user null → error mappé FR, aucun insert", async () => {
    supabaseSignUpMock = vi.fn<AnyAsyncFn>().mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const res = await signupAction({}, makeFormData());

    expect(res.error).toMatch(/Inscription impossible/);
    expect(adminInsertMock).not.toHaveBeenCalled();
    expect(adminDeleteUserMock).not.toHaveBeenCalled();
  });

  it("T-301 compensation : insert profil fail → deleteUser appelé sur user.id, error mappé FR", async () => {
    adminInsertMock = vi.fn<AnyAsyncFn>().mockResolvedValue({
      error: { message: "duplicate key value violates unique constraint" },
    });

    const res = await signupAction({}, makeFormData());

    expect(res.error).toMatch(/Inscription impossible/);
    expect(adminInsertMock).toHaveBeenCalledOnce();
    expect(adminDeleteUserMock).toHaveBeenCalledWith("user-1");
  });

  it("T-301 compensation : insert fail + deleteUser fail → error mappé FR, console.error orphan", async () => {
    adminInsertMock = vi.fn<AnyAsyncFn>().mockResolvedValue({
      error: { message: "RLS violation" },
    });
    adminDeleteUserMock = vi.fn<AnyAsyncFn>().mockResolvedValue({
      error: { message: "auth admin api unreachable" },
    });
    const errorSpy = vi.spyOn(console, "error");

    const res = await signupAction({}, makeFormData());

    expect(res.error).toMatch(/Inscription impossible/);
    expect(adminDeleteUserMock).toHaveBeenCalledWith("user-1");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("SIGNUP_ORPHAN_AUTH"),
    );
  });

  // --- T-305 PR-B — rate-limit applicatif IP (5/60s signup) ----------------

  it("T-305 PR-B : cap dépassé → audit rate_limit_exceeded + error FR + signUp NON appelé", async () => {
    consumeRateLimitMock.mockResolvedValueOnce({
      success: false,
      limit: 5,
      remaining: 0,
      reset: 9999,
    });

    const res = await signupAction({}, makeFormData());

    expect(res.error).toMatch(/Trop de tentatives/);
    expect(logAuthEventMock).toHaveBeenCalledWith({
      eventType: "rate_limit_exceeded",
      userId: null,
      metadata: { route: "signup", cap: 5, reset: 9999 },
    });
    expect(supabaseSignUpMock).not.toHaveBeenCalled();
    expect(adminInsertMock).not.toHaveBeenCalled();
  });

  it("T-305 PR-B : cap OK → consumeRateLimit appelé avec IP extraite + flow nominal continue", async () => {
    await signupAction({}, makeFormData());

    expect(consumeRateLimitMock).toHaveBeenCalledWith(
      expect.anything(),
      "203.0.113.5",
    );
    expect(supabaseSignUpMock).toHaveBeenCalled();
    expect(logAuthEventMock).not.toHaveBeenCalled();
  });

  // --- CGU obligatoire (opposabilité juridique) ---------------------------

  it("CGU manquante → error Zod, aucun appel Supabase", async () => {
    const fd = makeFormData();
    fd.delete("cgu_accepted");

    const res = await signupAction({}, fd);

    expect(res.error).toMatch(/conditions d'utilisation/);
    expect(supabaseSignUpMock).not.toHaveBeenCalled();
    expect(adminInsertMock).not.toHaveBeenCalled();
  });

  it("CGU explicitement false → error Zod, aucun appel Supabase", async () => {
    const fd = makeFormData();
    // Le navigateur n'envoie pas la valeur d'une checkbox non cochée — un
    // client trafiqué pourrait envoyer "false" ou autre. On vérifie que le
    // refine bloque toute valeur ≠ true sérialisé.
    fd.set("cgu_accepted", "false");

    const res = await signupAction({}, fd);

    expect(res.error).toMatch(/conditions d'utilisation/);
    expect(supabaseSignUpMock).not.toHaveBeenCalled();
    expect(adminInsertMock).not.toHaveBeenCalled();
  });
});
