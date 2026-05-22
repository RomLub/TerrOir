import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";

// F-062 (audit pré-launch 2026-05-11) — l'action importe @/lib/resend/send
// qui throw au module-load si RESEND_API_KEY absent. + le template
// password-changed-notice tire layout.tsx qui requiert NEXT_PUBLIC_APP_URL.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://www.terroir-local.fr";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.terroir-local.fr";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "https://pro.terroir-local.fr";
});

// vitest 4 : `vi.fn()` retourne `Mock<Procedure | Constructable>` qui n'est
// pas appelable. On force le type vers une signature de fonction concrète.
type AnyAsyncFn = (...args: unknown[]) => Promise<unknown>;

// --- Mocks ---------------------------------------------------------------
// On mocke 4 surfaces :
//   1. getSessionUser (lib/auth/session) → { id, email, ... } ou null
//   2. createClient (@supabase/supabase-js) → tempClient pour vérif mdp actuel
//   3. createSupabaseAdminClient (lib/supabase/admin) → admin.auth.admin.updateUserById
//      (admin path car « Secure password change » Dashboard exige AAL2 sur
//      l'API user-side — bypass via service_role après re-auth tempClient)
//   4. logAuthEvent (lib/audit-logs/log-auth-event) → assertion appel/non-appel

let getSessionUserMock: Mock<AnyAsyncFn>;
let tempSignInMock: Mock<AnyAsyncFn>;
let adminUpdateUserMock: Mock<AnyAsyncFn>;
let logAuthEventMock: Mock<AnyAsyncFn>;
// F-025 : rate-limit mock — par défaut success=true (pas de throttle).
let consumeRateLimitMock: Mock<AnyAsyncFn>;

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: (...args: unknown[]) => getSessionUserMock(...args),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: (...args: unknown[]) => tempSignInMock(...args),
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    auth: {
      admin: {
        updateUserById: (...args: unknown[]) => adminUpdateUserMock(...args),
      },
    },
  }),
}));

vi.mock("@/lib/audit-logs/log-auth-event", () => ({
  logAuthEvent: (...args: unknown[]) => logAuthEventMock(...args),
}));

vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimit: (...args: unknown[]) => consumeRateLimitMock(...args),
  getLoginRateLimit: () => ({ /* stub limiter, not introspected */ }),
}));

// F-062 (audit pré-launch 2026-05-11) — l'action appelle sendTemplate post-
// success pour envoyer la notification password_changed_notice. Mock pour
// éviter le throw module-load (RESEND_API_KEY) + isoler le test.
vi.mock("@/lib/resend/send", () => ({
  sendTemplate: vi.fn().mockResolvedValue({ ok: true, id: "msg_test" }),
}));

import { changePasswordAction } from "@/app/(consumer)/compte/password/_actions/change-password";

// --- Helpers --------------------------------------------------------------

const VALID_CURRENT = "OldPass123";
const VALID_NEW = "NewPass456789";

function makeFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("currentPassword", VALID_CURRENT);
  fd.set("newPassword", VALID_NEW);
  fd.set("newPasswordConfirm", VALID_NEW);
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

// --- Setup / teardown -----------------------------------------------------

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key-test");

  getSessionUserMock = vi.fn<AnyAsyncFn>().mockResolvedValue({
    id: "user-1",
    email: "user@example.com",
    roles: ["consumer"],
    isAdmin: false,
  });
  tempSignInMock = vi.fn<AnyAsyncFn>().mockResolvedValue({ error: null });
  adminUpdateUserMock = vi.fn<AnyAsyncFn>().mockResolvedValue({
    data: { user: { id: "user-1" } },
    error: null,
  });
  logAuthEventMock = vi.fn<AnyAsyncFn>().mockResolvedValue(undefined);
  // F-025 default : rate-limit always pass.
  consumeRateLimitMock = vi.fn<AnyAsyncFn>().mockResolvedValue({
    success: true,
    limit: 5,
    remaining: 4,
    reset: Date.now() + 60_000,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// --- Tests ----------------------------------------------------------------

describe("changePasswordAction", () => {
  it("happy path : current OK + new conforme → updateUser + logAuthEvent appelés", async () => {
    const res = await changePasswordAction({}, makeFormData());

    expect(res).toEqual({ success: true });
    expect(tempSignInMock).toHaveBeenCalledWith({
      email: "user@example.com",
      password: VALID_CURRENT,
    });
    expect(adminUpdateUserMock).toHaveBeenCalledWith("user-1", {
      password: VALID_NEW,
    });
    expect(logAuthEventMock).toHaveBeenCalledWith({
      eventType: "password_changed",
      userId: "user-1",
    });
  });

  it("pas de session → error session, ni signInWithPassword ni updateUser appelés", async () => {
    getSessionUserMock = vi.fn<AnyAsyncFn>().mockResolvedValue(null);

    const res = await changePasswordAction({}, makeFormData());

    expect(res.error).toMatch(/Session introuvable/);
    expect(tempSignInMock).not.toHaveBeenCalled();
    expect(adminUpdateUserMock).not.toHaveBeenCalled();
    expect(logAuthEventMock).not.toHaveBeenCalled();
  });

  it("current password incorrect → error, updateUser NON appelé, audit log NON appelé", async () => {
    tempSignInMock = vi.fn<AnyAsyncFn>().mockResolvedValue({
      error: { message: "Invalid login credentials" },
    });

    const res = await changePasswordAction({}, makeFormData());

    expect(res.error).toMatch(/actuel incorrect/);
    expect(tempSignInMock).toHaveBeenCalledOnce();
    expect(adminUpdateUserMock).not.toHaveBeenCalled();
    expect(logAuthEventMock).not.toHaveBeenCalled();
  });

  it("new password trop court (< 12 chars) → Zod fail, aucun appel Supabase", async () => {
    const res = await changePasswordAction(
      {},
      makeFormData({ newPassword: "Sh1", newPasswordConfirm: "Sh1" }),
    );

    expect(res.error).toMatch(/12 caractères/);
    expect(tempSignInMock).not.toHaveBeenCalled();
    expect(adminUpdateUserMock).not.toHaveBeenCalled();
    expect(logAuthEventMock).not.toHaveBeenCalled();
  });

  it("new password sans majuscule (complexité) → Zod fail", async () => {
    const res = await changePasswordAction(
      {},
      makeFormData({
        newPassword: "newpass123456",
        newPasswordConfirm: "newpass123456",
      }),
    );

    expect(res.error).toMatch(/majuscule/);
    expect(tempSignInMock).not.toHaveBeenCalled();
    expect(adminUpdateUserMock).not.toHaveBeenCalled();
  });

  it("confirm mismatch → Zod refine fail", async () => {
    const res = await changePasswordAction(
      {},
      makeFormData({ newPasswordConfirm: "Different456" }),
    );

    expect(res.error).toMatch(/correspondent pas/);
    expect(tempSignInMock).not.toHaveBeenCalled();
    expect(adminUpdateUserMock).not.toHaveBeenCalled();
  });

  it("F-025 rate-limit miss → rateLimited=true, signIn NON appelé, audit rate_limit_exceeded posé", async () => {
    consumeRateLimitMock = vi.fn<AnyAsyncFn>().mockResolvedValue({
      success: false,
      limit: 5,
      remaining: 0,
      reset: Date.now() + 30_000,
    });

    const res = await changePasswordAction({}, makeFormData());

    expect(res.rateLimited).toBe(true);
    expect(res.error).toMatch(/Trop de tentatives/);
    expect(res.retryAfterSeconds).toBeGreaterThan(0);
    // Pas de re-auth, pas d'update : on bloque AVANT le tempClient signIn.
    expect(tempSignInMock).not.toHaveBeenCalled();
    expect(adminUpdateUserMock).not.toHaveBeenCalled();
    // Audit log rate_limit_exceeded posé pour détection forensique.
    expect(logAuthEventMock).toHaveBeenCalledWith({
      eventType: "rate_limit_exceeded",
      userId: "user-1",
      metadata: expect.objectContaining({
        route: "change_password",
        cap: 5,
      }),
    });
  });

  it("F-025 rate-limit 6 calls successifs → 6e est rate-limited", async () => {
    // Simulation : 5 premiers OK (consume retourne success=true), 6e bloqué.
    let callIndex = 0;
    consumeRateLimitMock = vi.fn<AnyAsyncFn>().mockImplementation(() => {
      callIndex += 1;
      if (callIndex <= 5) {
        return Promise.resolve({
          success: true,
          limit: 5,
          remaining: 5 - callIndex,
          reset: Date.now() + 60_000,
        });
      }
      return Promise.resolve({
        success: false,
        limit: 5,
        remaining: 0,
        reset: Date.now() + 45_000,
      });
    });

    // 5 premiers calls : happy path (current correct, update success).
    for (let i = 1; i <= 5; i++) {
      const r = await changePasswordAction({}, makeFormData());
      expect(r.success).toBe(true);
    }
    // 6e call : rate-limited avant même la re-auth.
    const r6 = await changePasswordAction({}, makeFormData());
    expect(r6.rateLimited).toBe(true);
    expect(r6.error).toMatch(/Trop de tentatives/);
    // Total signIn calls : 5 (pas 6 — le 6e est court-circuité).
    expect(tempSignInMock).toHaveBeenCalledTimes(5);
  });

  it("updateUser Supabase rejette → error mappé FR + logAuthEvent NON appelé", async () => {
    adminUpdateUserMock = vi.fn<AnyAsyncFn>().mockResolvedValue({
      data: null,
      error: { message: "Some unexpected error from Supabase" },
    });

    const res = await changePasswordAction({}, makeFormData());

    expect(res.error).toMatch(/Impossible de mettre à jour/);
    expect(tempSignInMock).toHaveBeenCalledOnce();
    expect(adminUpdateUserMock).toHaveBeenCalledOnce();
    expect(logAuthEventMock).not.toHaveBeenCalled();
  });
});
