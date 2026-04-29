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

import { changePasswordAction } from "@/app/(consumer)/compte/password/_actions/change-password";

// --- Helpers --------------------------------------------------------------

const VALID_CURRENT = "OldPass123";
const VALID_NEW = "NewPass456";

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

  it("new password trop court (< 8 chars) → Zod fail, aucun appel Supabase", async () => {
    const res = await changePasswordAction(
      {},
      makeFormData({ newPassword: "Sh1", newPasswordConfirm: "Sh1" }),
    );

    expect(res.error).toMatch(/8 caractères/);
    expect(tempSignInMock).not.toHaveBeenCalled();
    expect(adminUpdateUserMock).not.toHaveBeenCalled();
    expect(logAuthEventMock).not.toHaveBeenCalled();
  });

  it("new password sans majuscule (complexité) → Zod fail", async () => {
    const res = await changePasswordAction(
      {},
      makeFormData({
        newPassword: "newpass123",
        newPasswordConfirm: "newpass123",
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
