import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";

// lib/env/urls.ts fail-fast au load si NEXT_PUBLIC_APP_URL ou
// NEXT_PUBLIC_ADMIN_URL ne sont pas définis (T-328 — email-redirect dérive
// désormais de ces vars). Hoist le stub avant les imports static.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://www.terroir-local.fr";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "https://pro.terroir-local.fr";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.terroir-local.fr";
});

// vitest 4 : `vi.fn()` retourne `Mock<Procedure | Constructable>` qui n'est
// pas appelable. On force le type vers une signature de fonction concrète.
type AnyAsyncFn = (...args: unknown[]) => Promise<unknown>;
type AnySyncFn = (...args: unknown[]) => unknown;

// --- Mocks ----------------------------------------------------------------
//
// Le module connexion/actions.ts héberge plusieurs server actions
// (loginAction, requestMagicLinkAction, requestPasswordResetAction). On
// stub les dépendances Next.js loadées au top-level pour que l'import de
// requestPasswordResetAction ne fasse pas tomber les autres actions à la
// compilation du module — même si elles ne sont pas appelées dans ces tests.

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  headers: vi.fn(() => ({ get: () => null })),
  cookies: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

let resetPasswordForEmailMock: Mock<AnyAsyncFn>;
let signInWithPasswordMock: Mock<AnyAsyncFn>;
let signInWithOtpMock: Mock<AnyAsyncFn>;
let logAuthEventMock: Mock<AnyAsyncFn>;
let maybeSingleMock: Mock<AnyAsyncFn>;

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    auth: {
      signInWithOtp: (...args: unknown[]) => signInWithOtpMock(...args),
      signInWithPassword: (...args: unknown[]) =>
        signInWithPasswordMock(...args),
      resetPasswordForEmail: (...args: unknown[]) =>
        resetPasswordForEmailMock(...args),
    },
  }),
}));

// Mock chainable du client admin : .from(table).select(cols).ilike(col, val).maybeSingle()
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: () => ({
      select: () => ({
        ilike: () => ({
          maybeSingle: (...args: unknown[]) => maybeSingleMock(...args),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/audit-logs/log-auth-event", () => ({
  logAuthEvent: (...args: unknown[]) => logAuthEventMock(...args),
  extractRequestContext: () => ({
    ipAddress: "203.0.113.5",
    userAgent: null,
  }),
}));

// T-305 PR-B : mock rate-limit. Helpers retournent un fake limiter (la valeur
// n'est pas inspectée — seul consumeRateLimit l'est). Default = cap not
// reached (success=true) pour ne pas casser les tests existants ; les tests
// PR-B override via mockResolvedValueOnce.
const consumeRateLimitMock = vi.hoisted(() =>
  vi.fn(async () => ({ success: true, limit: 5, remaining: 4, reset: 0 })),
);

vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimit: consumeRateLimitMock,
  getLoginRateLimit: () => ({}),
  getRecoveryRateLimit: () => ({}),
}));

// Sous-modules tirés transitive par loginAction et requestMagicLinkAction —
// stubs minimaux pour éviter de charger des dépendances Supabase server lors
// du module load.
vi.mock("@/lib/auth/post-login-redirect", () => ({
  loadRoleSnapshot: vi.fn(),
  resolvePostLoginPath: vi.fn(),
}));

vi.mock("@/lib/auth/redirect-cookie", () => ({
  setRedirectAfterAuth: vi.fn(),
}));

import {
  loginAction,
  requestMagicLinkAction,
  requestPasswordResetAction,
} from "@/app/connexion/actions";
import {
  PASSWORD_RESET_ADMIN,
  PASSWORD_RESET_DEFAULT,
} from "@/lib/auth/email-redirect";

// --- Helpers --------------------------------------------------------------

function makeFormData(email: string | null): FormData {
  const fd = new FormData();
  if (email !== null) fd.set("email", email);
  return fd;
}

function makeLoginFormData(email: string, password: string): FormData {
  const fd = new FormData();
  fd.set("email", email);
  fd.set("password", password);
  return fd;
}

// --- Setup / teardown -----------------------------------------------------

beforeEach(() => {
  resetPasswordForEmailMock = vi
    .fn<AnyAsyncFn>()
    .mockResolvedValue({ data: {}, error: null });
  signInWithPasswordMock = vi
    .fn<AnyAsyncFn>()
    .mockResolvedValue({ data: { user: null }, error: null });
  signInWithOtpMock = vi
    .fn<AnyAsyncFn>()
    .mockResolvedValue({ data: {}, error: null });
  logAuthEventMock = vi.fn<AnyAsyncFn>().mockResolvedValue(undefined);
  maybeSingleMock = vi
    .fn<AnyAsyncFn>()
    .mockResolvedValue({ data: null, error: null });
  consumeRateLimitMock.mockReset();
  consumeRateLimitMock.mockResolvedValue({
    success: true,
    limit: 5,
    remaining: 4,
    reset: 0,
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Tests ----------------------------------------------------------------

describe("requestPasswordResetAction", () => {
  it("happy path consumer → resetPasswordForEmail appelé avec PASSWORD_RESET_DEFAULT (URL figée, pas Host header)", async () => {
    const result = await requestPasswordResetAction(
      {},
      makeFormData("user@example.com"),
    );

    expect(resetPasswordForEmailMock).toHaveBeenCalledWith(
      "user@example.com",
      { redirectTo: PASSWORD_RESET_DEFAULT },
    );
    expect(result).toEqual({ sent: true });
  });

  it("happy path admin → resetPasswordForEmail appelé avec PASSWORD_RESET_ADMIN", async () => {
    maybeSingleMock.mockResolvedValue({
      data: { id: "admin-1" },
      error: null,
    });

    await requestPasswordResetAction({}, makeFormData("admin@example.com"));

    expect(resetPasswordForEmailMock).toHaveBeenCalledWith(
      "admin@example.com",
      { redirectTo: PASSWORD_RESET_ADMIN },
    );
  });

  it("email invalide Zod → error format et resetPasswordForEmail jamais appelé", async () => {
    const result = await requestPasswordResetAction(
      {},
      makeFormData("not-an-email"),
    );

    expect(result.error).toBe("Email invalide");
    expect(result.sent).toBeUndefined();
    expect(resetPasswordForEmailMock).not.toHaveBeenCalled();
    expect(logAuthEventMock).not.toHaveBeenCalled();
  });

  it("admin lookup KO (DB down) → fail-open warn + reset envoyé sur DEFAULT (www)", async () => {
    maybeSingleMock.mockRejectedValue(new Error("DB down"));

    const result = await requestPasswordResetAction(
      {},
      makeFormData("user@example.com"),
    );

    expect(resetPasswordForEmailMock).toHaveBeenCalledWith(
      "user@example.com",
      { redirectTo: PASSWORD_RESET_DEFAULT },
    );
    expect(result).toEqual({ sent: true });
    // Le helper PASSWORD_RESET_ADMIN ne doit JAMAIS être passé en cas de
    // fail-open : un admin malheureux retentera depuis admin.* sans avoir
    // exposé le système à un Host header injection.
    expect(resetPasswordForEmailMock).not.toHaveBeenCalledWith(
      expect.anything(),
      { redirectTo: PASSWORD_RESET_ADMIN },
    );
  });

  it("audit log password_reset_request écrit systématiquement (enumeration-resistance préservée)", async () => {
    await requestPasswordResetAction({}, makeFormData("user@example.com"));

    expect(logAuthEventMock).toHaveBeenCalledWith({
      eventType: "password_reset_request",
      userId: null,
      metadata: { email: "user@example.com" },
    });
  });
});

describe("loginAction (T-309 — audit login_failed sur fail path)", () => {
  it("invalid_credentials → logAuthEvent login_failed avec reason_code=invalid_credentials + email plaintext + userId null", async () => {
    signInWithPasswordMock.mockResolvedValue({
      data: { user: null },
      error: {
        code: "invalid_credentials",
        message: "Invalid login credentials",
      },
    });

    const result = await loginAction(
      {},
      makeLoginFormData("user@example.com", "wrongpass"),
    );

    expect(result).toEqual({ error: "Identifiants invalides" });
    expect(logAuthEventMock).toHaveBeenCalledWith({
      eventType: "login_failed",
      userId: null,
      metadata: {
        email: "user@example.com",
        reason_code: "invalid_credentials",
      },
    });
  });

  it("email_not_confirmed → reason_code=email_not_confirmed (compte pending confirmation)", async () => {
    signInWithPasswordMock.mockResolvedValue({
      data: { user: null },
      error: {
        code: "email_not_confirmed",
        message: "Email not confirmed",
      },
    });

    await loginAction({}, makeLoginFormData("pending@example.com", "anypass"));

    expect(logAuthEventMock).toHaveBeenCalledWith({
      eventType: "login_failed",
      userId: null,
      metadata: {
        email: "pending@example.com",
        reason_code: "email_not_confirmed",
      },
    });
  });

  it("erreur générique inconnue → reason_code=technical (catégorie fallback)", async () => {
    signInWithPasswordMock.mockResolvedValue({
      data: { user: null },
      error: {
        code: "unknown_supabase_code",
        message: "Some opaque server error",
      },
    });

    await loginAction({}, makeLoginFormData("user@example.com", "pass"));

    expect(logAuthEventMock).toHaveBeenCalledWith({
      eventType: "login_failed",
      userId: null,
      metadata: {
        email: "user@example.com",
        reason_code: "technical",
      },
    });
  });
});

// =============================================================================
// T-305 PR-B — rate-limit applicatif IP sur loginAction (5/60s mutualisé avec
// magic link), requestMagicLinkAction (5/60s mutualisé avec login D2),
// requestPasswordResetAction (3/60s helper recovery dédié).
// =============================================================================

describe("loginAction T-305 PR-B rate-limit", () => {
  it("cap dépassé → audit rate_limit_exceeded route=login + error FR + signInWithPassword NON appelé", async () => {
    consumeRateLimitMock.mockResolvedValueOnce({
      success: false,
      limit: 5,
      remaining: 0,
      reset: 12345,
    });

    const res = await loginAction(
      {},
      makeLoginFormData("user@example.com", "pass"),
    );

    expect(res).toEqual({
      error: "Trop de tentatives. Réessayez dans quelques minutes.",
    });
    expect(logAuthEventMock).toHaveBeenCalledWith({
      eventType: "rate_limit_exceeded",
      userId: null,
      metadata: { route: "login", cap: 5, reset: 12345 },
    });
    expect(signInWithPasswordMock).not.toHaveBeenCalled();
    // login_failed audit ne doit PAS être loggué — short-circuit avant
    // signInWithPassword (l'event login_failed est réservé au cas
    // credentials rejetés par Supabase, pas au rate-limit applicatif).
    expect(logAuthEventMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "login_failed" }),
    );
  });

  it("cap OK → consumeRateLimit appelé avec IP extraite + flow nominal continue", async () => {
    signInWithPasswordMock.mockResolvedValue({
      data: { user: null },
      error: { code: "invalid_credentials", message: "bad creds" },
    });

    await loginAction({}, makeLoginFormData("user@example.com", "pass"));

    expect(consumeRateLimitMock).toHaveBeenCalledWith(
      expect.anything(),
      "203.0.113.5",
    );
    expect(signInWithPasswordMock).toHaveBeenCalled();
  });
});

describe("requestMagicLinkAction T-305 PR-B rate-limit", () => {
  it("cap dépassé → audit rate_limit_exceeded route=magic_link + error FR + signInWithOtp NON appelé", async () => {
    consumeRateLimitMock.mockResolvedValueOnce({
      success: false,
      limit: 5,
      remaining: 0,
      reset: 7777,
    });

    const res = await requestMagicLinkAction(
      {},
      makeFormData("user@example.com"),
    );

    expect(res).toEqual({
      error: "Trop de tentatives. Réessayez dans quelques minutes.",
    });
    expect(logAuthEventMock).toHaveBeenCalledWith({
      eventType: "rate_limit_exceeded",
      userId: null,
      metadata: { route: "magic_link", cap: 5, reset: 7777 },
    });
    expect(signInWithOtpMock).not.toHaveBeenCalled();
    expect(maybeSingleMock).not.toHaveBeenCalled();
  });

  it("cap OK → consumeRateLimit appelé avec IP extraite + signInWithOtp appelé", async () => {
    await requestMagicLinkAction({}, makeFormData("user@example.com"));

    expect(consumeRateLimitMock).toHaveBeenCalledWith(
      expect.anything(),
      "203.0.113.5",
    );
    expect(signInWithOtpMock).toHaveBeenCalled();
  });
});

describe("requestPasswordResetAction T-305 PR-B rate-limit", () => {
  it("cap dépassé → audit rate_limit_exceeded route=recovery + error FR + resetPasswordForEmail NON appelé", async () => {
    consumeRateLimitMock.mockResolvedValueOnce({
      success: false,
      limit: 3,
      remaining: 0,
      reset: 4242,
    });

    const res = await requestPasswordResetAction(
      {},
      makeFormData("user@example.com"),
    );

    expect(res).toEqual({
      error: "Trop de tentatives. Réessayez dans quelques minutes.",
    });
    expect(logAuthEventMock).toHaveBeenCalledWith({
      eventType: "rate_limit_exceeded",
      userId: null,
      metadata: { route: "recovery", cap: 3, reset: 4242 },
    });
    expect(resetPasswordForEmailMock).not.toHaveBeenCalled();
    expect(maybeSingleMock).not.toHaveBeenCalled();
  });

  it("cap OK → consumeRateLimit appelé avec IP extraite + resetPasswordForEmail appelé", async () => {
    await requestPasswordResetAction({}, makeFormData("user@example.com"));

    expect(consumeRateLimitMock).toHaveBeenCalledWith(
      expect.anything(),
      "203.0.113.5",
    );
    expect(resetPasswordForEmailMock).toHaveBeenCalled();
  });
});
