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
let logAuthEventMock: Mock<AnyAsyncFn>;
let maybeSingleMock: Mock<AnyAsyncFn>;

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    auth: {
      // signInWithPassword + signInWithOtp ne sont pas appelés par
      // requestPasswordResetAction, mais doivent exister pour le module load.
      signInWithPassword: vi.fn(),
      signInWithOtp: vi.fn(),
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

import { requestPasswordResetAction } from "@/app/connexion/actions";
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

// --- Setup / teardown -----------------------------------------------------

beforeEach(() => {
  resetPasswordForEmailMock = vi
    .fn<AnyAsyncFn>()
    .mockResolvedValue({ data: {}, error: null });
  logAuthEventMock = vi.fn<AnyAsyncFn>().mockResolvedValue(undefined);
  maybeSingleMock = vi
    .fn<AnyAsyncFn>()
    .mockResolvedValue({ data: null, error: null });
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
