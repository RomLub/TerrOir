import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";

type AnyAsyncFn = (...args: unknown[]) => Promise<unknown>;
type AnySyncFn = (...args: unknown[]) => unknown;

let sessionMock: Mock<AnyAsyncFn>;
let logAuthEventMock: Mock<AnyAsyncFn>;
let adminUpdateUserByIdMock: Mock<AnyAsyncFn>;
let userSignOutMock: Mock<AnyAsyncFn>;
let updateSpy: Mock<AnySyncFn>;
let updateResponse: { error: { message: string } | null };
// SELECT response queue : the action does 2 SELECTs (current + new)
let selectQueue: { data: Record<string, unknown> | null; error: unknown }[] = [];

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: (...args: unknown[]) => sessionMock(...args),
}));

vi.mock("@/lib/audit-logs/log-auth-event", () => ({
  logAuthEvent: (...args: unknown[]) => logAuthEventMock(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    auth: {
      signOut: (...args: unknown[]) => userSignOutMock(...args),
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    auth: {
      admin: {
        updateUserById: (...args: unknown[]) => adminUpdateUserByIdMock(...args),
      },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: () =>
                  Promise.resolve(
                    selectQueue.shift() ?? { data: null, error: null },
                  ),
              }),
            }),
          }),
        }),
      }),
      update: (payload: unknown) => {
        updateSpy(payload);
        return {
          eq: () => Promise.resolve(updateResponse),
        };
      },
    }),
  }),
}));

import { completeEmailChangeAction } from "@/app/(consumer)/compte/profil/_actions/complete-email-change";

function makeFormData(newEmail: string): FormData {
  const fd = new FormData();
  fd.set("newEmail", newEmail);
  return fd;
}

beforeEach(() => {
  sessionMock = vi.fn<AnyAsyncFn>().mockResolvedValue({
    id: "user-1",
    email: "old@example.com",
    roles: ["consumer"],
    isAdmin: false,
  });
  logAuthEventMock = vi.fn<AnyAsyncFn>().mockResolvedValue(undefined);
  adminUpdateUserByIdMock = vi
    .fn<AnyAsyncFn>()
    .mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  userSignOutMock = vi.fn<AnyAsyncFn>().mockResolvedValue({ error: null });
  updateSpy = vi.fn<AnySyncFn>();
  updateResponse = { error: null };
  selectQueue = [
    {
      data: {
        consumed_at: new Date().toISOString(),
        email: "old@example.com",
      },
      error: null,
    },
    {
      data: { consumed_at: new Date().toISOString(), email: "new@example.com" },
      error: null,
    },
  ];
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("completeEmailChangeAction — happy path", () => {
  it("auth.update + users.update + signOut('others') + audit log", async () => {
    const res = await completeEmailChangeAction(
      {},
      makeFormData("new@example.com"),
    );

    expect(res).toEqual({ ok: true });
    expect(adminUpdateUserByIdMock).toHaveBeenCalledWith("user-1", {
      email: "new@example.com",
    });
    expect(updateSpy).toHaveBeenCalledWith({ email: "new@example.com" });
    expect(userSignOutMock).toHaveBeenCalledWith({ scope: "others" });
    expect(logAuthEventMock).toHaveBeenCalledWith({
      eventType: "account_email_change_completed",
      userId: "user-1",
      metadata: expect.objectContaining({
        old_email_masked: expect.any(String),
        new_email_masked: expect.any(String),
      }),
    });
  });

  it("signOut error → warn mais flow réussit, audit log appelé", async () => {
    userSignOutMock = vi
      .fn<AnyAsyncFn>()
      .mockResolvedValue({ error: { message: "signOut down" } });
    const res = await completeEmailChangeAction(
      {},
      makeFormData("new@example.com"),
    );
    expect(res).toEqual({ ok: true });
    expect(logAuthEventMock).toHaveBeenCalled();
  });
});

describe("completeEmailChangeAction — guards", () => {
  it("pas de session → reason=session", async () => {
    sessionMock = vi.fn<AnyAsyncFn>().mockResolvedValue(null);
    const res = await completeEmailChangeAction(
      {},
      makeFormData("new@example.com"),
    );
    expect(res).toEqual({ ok: false, reason: "session" });
    expect(adminUpdateUserByIdMock).not.toHaveBeenCalled();
  });

  it("email format invalide → reason=format", async () => {
    const res = await completeEmailChangeAction({}, makeFormData("not-email"));
    expect(res).toEqual({ ok: false, reason: "format" });
  });

  it("newEmail === currentEmail (case-insensitive) → reason=same_email", async () => {
    const res = await completeEmailChangeAction(
      {},
      makeFormData("OLD@EXAMPLE.com"),
    );
    expect(res).toEqual({ ok: false, reason: "same_email" });
  });
});

describe("completeEmailChangeAction — defensive recheck", () => {
  it("step=current row absente → reason=flow_invalid", async () => {
    selectQueue = [{ data: null, error: null }];
    const res = await completeEmailChangeAction(
      {},
      makeFormData("new@example.com"),
    );
    expect(res).toEqual({ ok: false, reason: "flow_invalid" });
    expect(adminUpdateUserByIdMock).not.toHaveBeenCalled();
  });

  it("step=current row consumed_at NULL → reason=flow_invalid", async () => {
    selectQueue = [
      { data: { consumed_at: null, email: "old@example.com" }, error: null },
    ];
    const res = await completeEmailChangeAction(
      {},
      makeFormData("new@example.com"),
    );
    expect(res).toEqual({ ok: false, reason: "flow_invalid" });
    expect(adminUpdateUserByIdMock).not.toHaveBeenCalled();
  });

  it("step=new row absente → reason=flow_invalid", async () => {
    selectQueue = [
      {
        data: {
          consumed_at: new Date().toISOString(),
          email: "old@example.com",
        },
        error: null,
      },
      { data: null, error: null },
    ];
    const res = await completeEmailChangeAction(
      {},
      makeFormData("new@example.com"),
    );
    expect(res).toEqual({ ok: false, reason: "flow_invalid" });
  });

  it("step=new row email mismatch (user a changé d'email entre verify et complete) → flow_invalid", async () => {
    selectQueue = [
      {
        data: {
          consumed_at: new Date().toISOString(),
          email: "old@example.com",
        },
        error: null,
      },
      {
        data: {
          consumed_at: new Date().toISOString(),
          email: "DIFFERENT@example.com",
        },
        error: null,
      },
    ];
    const res = await completeEmailChangeAction(
      {},
      makeFormData("new@example.com"),
    );
    expect(res).toEqual({ ok: false, reason: "flow_invalid" });
    expect(adminUpdateUserByIdMock).not.toHaveBeenCalled();
  });
});

describe("completeEmailChangeAction — admin update errors", () => {
  it("auth.updateUserById fail collision → reason=email_collision", async () => {
    adminUpdateUserByIdMock = vi.fn<AnyAsyncFn>().mockResolvedValue({
      data: null,
      error: { message: "duplicate key value violates email_exists" },
    });
    const res = await completeEmailChangeAction(
      {},
      makeFormData("new@example.com"),
    );
    expect(res).toEqual({ ok: false, reason: "email_collision" });
    expect(updateSpy).not.toHaveBeenCalled();
    expect(logAuthEventMock).not.toHaveBeenCalled();
  });

  it("auth.updateUserById fail générique → reason=auth_update_failed", async () => {
    adminUpdateUserByIdMock = vi.fn<AnyAsyncFn>().mockResolvedValue({
      data: null,
      error: { message: "unexpected GoTrue error" },
    });
    const res = await completeEmailChangeAction(
      {},
      makeFormData("new@example.com"),
    );
    expect(res).toEqual({ ok: false, reason: "auth_update_failed" });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("public.users update fail → reason=users_update_failed (auth.users déjà muté = désynchro forensique)", async () => {
    updateResponse = { error: { message: "unique constraint violation" } };
    const res = await completeEmailChangeAction(
      {},
      makeFormData("new@example.com"),
    );
    expect(res).toEqual({ ok: false, reason: "users_update_failed" });
    expect(adminUpdateUserByIdMock).toHaveBeenCalled();
    expect(userSignOutMock).not.toHaveBeenCalled();
    expect(logAuthEventMock).not.toHaveBeenCalled();
  });
});
