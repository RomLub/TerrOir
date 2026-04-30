import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";

vi.hoisted(() => {
  process.env.EMAIL_CHANGE_OTP_SECRET =
    process.env.EMAIL_CHANGE_OTP_SECRET ??
    "test-only-secret-do-not-use-in-prod-32bytes-min";
});

type AnyAsyncFn = (...args: unknown[]) => Promise<unknown>;
type AnySyncFn = (...args: unknown[]) => unknown;

let sessionMock: Mock<AnyAsyncFn>;
let verifyHashMock: Mock<AnyAsyncFn>;
let logAuthEventMock: Mock<AnyAsyncFn>;
let updateSpy: Mock<AnySyncFn>;
let selectResponse: { data: Record<string, unknown> | null; error: { message: string } | null };
let updateResponse: { error: { message: string } | null };

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: (...args: unknown[]) => sessionMock(...args),
}));

vi.mock("@/lib/audit-logs/log-auth-event", () => ({
  logAuthEvent: (...args: unknown[]) => logAuthEventMock(...args),
}));

vi.mock("@/lib/email-change/hmac", () => ({
  hashOtp: () => Promise.resolve("dummy-hash"),
  verifyHash: (...args: unknown[]) => verifyHashMock(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            is: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: () => Promise.resolve(selectResponse),
                }),
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

import { verifyOtpAction } from "@/app/(consumer)/compte/profil/_actions/verify-otp";

function makeFormData(step: string, code: string): FormData {
  const fd = new FormData();
  fd.set("step", step);
  fd.set("code", code);
  return fd;
}

function makeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "row-uuid-1",
    user_id: "user-1",
    step: "current",
    email: "old@example.com",
    code_hash: "fake-hash-deadbeef",
    expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    consumed_at: null,
    attempts: 0,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  sessionMock = vi.fn<AnyAsyncFn>().mockResolvedValue({
    id: "user-1",
    email: "old@example.com",
    roles: ["consumer"],
    isAdmin: false,
  });
  verifyHashMock = vi.fn<AnyAsyncFn>().mockResolvedValue(true);
  logAuthEventMock = vi.fn<AnyAsyncFn>().mockResolvedValue(undefined);
  updateSpy = vi.fn<AnySyncFn>();
  selectResponse = { data: makeRow(), error: null };
  updateResponse = { error: null };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("verifyOtpAction — happy path", () => {
  it("code valide → consume row + audit verified + ok=true", async () => {
    const res = await verifyOtpAction({}, makeFormData("current", "123456"));
    expect(res).toEqual({ ok: true });
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ consumed_at: expect.any(String) }),
    );
    expect(logAuthEventMock).toHaveBeenCalledWith({
      eventType: "account_otp_verified",
      userId: "user-1",
      metadata: { step: "current" },
    });
  });
});

describe("verifyOtpAction — guards", () => {
  it("pas de session → reason=session, aucun call DB", async () => {
    sessionMock = vi.fn<AnyAsyncFn>().mockResolvedValue(null);
    const res = await verifyOtpAction({}, makeFormData("current", "123456"));
    expect(res).toEqual({ ok: false, reason: "session" });
    expect(updateSpy).not.toHaveBeenCalled();
    expect(logAuthEventMock).not.toHaveBeenCalled();
  });

  it("step invalide → reason=format", async () => {
    const fd = new FormData();
    fd.set("step", "wrong");
    fd.set("code", "123456");
    const res = await verifyOtpAction({}, fd);
    expect(res).toEqual({ ok: false, reason: "format" });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("code 5 chiffres → reason=format (isValidOtpFormat fail)", async () => {
    const res = await verifyOtpAction({}, makeFormData("current", "12345"));
    expect(res).toEqual({ ok: false, reason: "format" });
  });

  it("code alpha → reason=format", async () => {
    const res = await verifyOtpAction({}, makeFormData("current", "abcdef"));
    expect(res).toEqual({ ok: false, reason: "format" });
  });
});

describe("verifyOtpAction — flow states", () => {
  it("aucune row trouvée → reason=no_active", async () => {
    selectResponse = { data: null, error: null };
    const res = await verifyOtpAction({}, makeFormData("current", "123456"));
    expect(res).toEqual({ ok: false, reason: "no_active" });
    expect(updateSpy).not.toHaveBeenCalled();
    expect(logAuthEventMock).not.toHaveBeenCalled();
  });

  it("erreur SELECT DB → reason=no_active (fail safe)", async () => {
    selectResponse = { data: null, error: { message: "timeout" } };
    const res = await verifyOtpAction({}, makeFormData("current", "123456"));
    expect(res).toEqual({ ok: false, reason: "no_active" });
  });

  it("row expirée → audit account_otp_expired + reason=expired", async () => {
    selectResponse = {
      data: makeRow({
        expires_at: new Date(Date.now() - 60_000).toISOString(),
      }),
      error: null,
    };
    const res = await verifyOtpAction({}, makeFormData("current", "123456"));
    expect(res).toEqual({ ok: false, reason: "expired" });
    expect(logAuthEventMock).toHaveBeenCalledWith({
      eventType: "account_otp_expired",
      userId: "user-1",
      metadata: { step: "current" },
    });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("row attempts=5 (pre-check défensif) → invalidate + audit + reason=attempts_exceeded", async () => {
    selectResponse = { data: makeRow({ attempts: 5 }), error: null };
    const res = await verifyOtpAction({}, makeFormData("current", "123456"));
    expect(res).toEqual({ ok: false, reason: "attempts_exceeded" });
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ consumed_at: expect.any(String) }),
    );
    expect(logAuthEventMock).toHaveBeenCalledWith({
      eventType: "account_otp_attempts_exceeded",
      userId: "user-1",
      metadata: { step: "current", attempts: 5 },
    });
  });
});

describe("verifyOtpAction — wrong code", () => {
  it("code faux row attempts=0 → newAttempts=1, audit invalid, attemptsRemaining=4", async () => {
    verifyHashMock = vi.fn<AnyAsyncFn>().mockResolvedValue(false);
    const res = await verifyOtpAction({}, makeFormData("current", "999999"));
    expect(res).toEqual({
      ok: false,
      reason: "invalid",
      attemptsRemaining: 4,
    });
    expect(updateSpy).toHaveBeenCalledWith({ attempts: 1 });
    expect(logAuthEventMock).toHaveBeenCalledWith({
      eventType: "account_otp_invalid",
      userId: "user-1",
      metadata: { step: "current", attempts: 1 },
    });
  });

  it("code faux row attempts=3 → newAttempts=4, attemptsRemaining=1", async () => {
    verifyHashMock = vi.fn<AnyAsyncFn>().mockResolvedValue(false);
    selectResponse = { data: makeRow({ attempts: 3 }), error: null };
    const res = await verifyOtpAction({}, makeFormData("current", "999999"));
    expect(res).toEqual({
      ok: false,
      reason: "invalid",
      attemptsRemaining: 1,
    });
  });

  it("code faux row attempts=4 → newAttempts=5 cap → invalidate + reason=attempts_exceeded", async () => {
    verifyHashMock = vi.fn<AnyAsyncFn>().mockResolvedValue(false);
    selectResponse = { data: makeRow({ attempts: 4 }), error: null };
    const res = await verifyOtpAction({}, makeFormData("current", "999999"));
    expect(res).toEqual({ ok: false, reason: "attempts_exceeded" });
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        attempts: 5,
        consumed_at: expect.any(String),
      }),
    );
    expect(logAuthEventMock).toHaveBeenCalledWith({
      eventType: "account_otp_attempts_exceeded",
      userId: "user-1",
      metadata: { step: "current", attempts: 5 },
    });
  });
});
