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
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3001";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002";
});

// vitest 4 : `vi.fn()` retourne un Mock qui n'est pas appelable directement.
// On force le type vers une signature concrète.
type AnyAsyncFn = (...args: unknown[]) => Promise<unknown>;
type AnySyncFn = (...args: unknown[]) => unknown;

let sessionMock: Mock<AnyAsyncFn>;
let rateLimitMock: Mock<AnyAsyncFn>;
let newEmailRateLimitMock: Mock<AnyAsyncFn>;
let sendTemplateMock: Mock<AnyAsyncFn>;
let logAuthEventMock: Mock<AnyAsyncFn>;
let updateSpy: Mock<AnySyncFn>;
let insertSpy: Mock<AnySyncFn>;
let invalidateResponse: { error: { message: string } | null };
let insertResponse: { error: { message: string } | null };

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: (...args: unknown[]) => sessionMock(...args),
}));

vi.mock("@/lib/email-change/rate-limit", () => ({
  checkOtpRateLimit: (...args: unknown[]) => rateLimitMock(...args),
}));

// F-056 : helper Upstash secondaire keyé sur newEmail (anti-harcèlement step=new).
vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimit: (...args: unknown[]) => newEmailRateLimitMock(...args),
  getOtpNewEmailRateLimit: () => ({}),
}));

vi.mock("@/lib/resend/send", () => ({
  sendTemplate: (...args: unknown[]) => sendTemplateMock(...args),
}));

vi.mock("@/lib/audit-logs/log-auth-event", () => ({
  logAuthEvent: (...args: unknown[]) => logAuthEventMock(...args),
  extractRequestContext: () => ({ ipAddress: null, userAgent: null }),
}));

vi.mock("next/headers", () => ({
  headers: () => {
    throw new Error("no headers in test");
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: () => ({
      update: (payload: unknown) => {
        updateSpy(payload);
        return {
          eq: () => ({
            eq: () => ({
              is: () => Promise.resolve(invalidateResponse),
            }),
          }),
        };
      },
      insert: (payload: unknown) => {
        insertSpy(payload);
        return Promise.resolve(insertResponse);
      },
    }),
  }),
}));

import { requestOtpAction } from "@/app/(consumer)/compte/profil/_actions/request-otp";

function makeFormData(step: string, newEmail: string): FormData {
  const fd = new FormData();
  fd.set("step", step);
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
  rateLimitMock = vi.fn<AnyAsyncFn>().mockResolvedValue({ ok: true });
  newEmailRateLimitMock = vi.fn<AnyAsyncFn>().mockResolvedValue({
    success: true,
    limit: 3,
    remaining: 2,
    reset: Date.now() + 3600_000,
  });
  sendTemplateMock = vi
    .fn<AnyAsyncFn>()
    .mockResolvedValue({ ok: true, id: "resend-msg-id" });
  logAuthEventMock = vi.fn<AnyAsyncFn>().mockResolvedValue(undefined);
  updateSpy = vi.fn<AnySyncFn>();
  insertSpy = vi.fn<AnySyncFn>();
  invalidateResponse = { error: null };
  insertResponse = { error: null };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("requestOtpAction — happy paths", () => {
  it("step=current : OTP à l'ancienne adresse, hash 64-hex, audit log", async () => {
    const res = await requestOtpAction(
      {},
      makeFormData("current", "new@example.com"),
    );

    expect(res).toEqual({ ok: true });
    expect(rateLimitMock).toHaveBeenCalledWith("user-1", "current");
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ consumed_at: expect.any(String) }),
    );
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        step: "current",
        email: "old@example.com",
        code_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
        attempts: 0,
        ip_address: null,
        user_agent: null,
      }),
    );
    expect(sendTemplateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "old@example.com",
        template: "email-change-otp-current",
        userId: "user-1",
      }),
    );
    expect(logAuthEventMock).toHaveBeenCalledWith({
      eventType: "account_otp_requested",
      userId: "user-1",
      metadata: expect.objectContaining({ step: "current" }),
    });
  });

  it("step=new : OTP à la nouvelle adresse", async () => {
    const res = await requestOtpAction(
      {},
      makeFormData("new", "new@example.com"),
    );
    expect(res).toEqual({ ok: true });
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ step: "new", email: "new@example.com" }),
    );
    expect(sendTemplateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "new@example.com",
        template: "email-change-otp-new",
      }),
    );
  });

  it("expires_at est ~10 min dans le futur", async () => {
    const before = Date.now();
    await requestOtpAction({}, makeFormData("current", "new@example.com"));
    const after = Date.now();

    const insertCall = insertSpy.mock.calls[0]?.[0] as {
      expires_at: string;
    };
    const expiresMs = new Date(insertCall.expires_at).getTime();
    expect(expiresMs).toBeGreaterThanOrEqual(before + 10 * 60 * 1000);
    expect(expiresMs).toBeLessThanOrEqual(after + 10 * 60 * 1000 + 100);
  });
});

describe("requestOtpAction — guards", () => {
  it("pas de session → error, aucun appel DB ni email", async () => {
    sessionMock = vi.fn<AnyAsyncFn>().mockResolvedValue(null);
    const res = await requestOtpAction(
      {},
      makeFormData("current", "new@example.com"),
    );
    expect(res.error).toMatch(/Session/);
    expect(insertSpy).not.toHaveBeenCalled();
    expect(sendTemplateMock).not.toHaveBeenCalled();
    expect(logAuthEventMock).not.toHaveBeenCalled();
  });

  it("email format invalide → error Zod", async () => {
    const res = await requestOtpAction(
      {},
      makeFormData("current", "not-an-email"),
    );
    expect(res.error).toMatch(/Email invalide/);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("step invalide → error Zod, aucun side effect", async () => {
    const fd = new FormData();
    fd.set("step", "wrong");
    fd.set("newEmail", "new@example.com");
    const res = await requestOtpAction({}, fd);
    expect(res.error).toBeDefined();
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("newEmail === currentEmail (case-insensitive) → error identique", async () => {
    const res = await requestOtpAction(
      {},
      makeFormData("new", "OLD@EXAMPLE.com"),
    );
    expect(res.error).toMatch(/identique/);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("rate-limit hit → error avec retryAfterSeconds", async () => {
    rateLimitMock = vi
      .fn<AnyAsyncFn>()
      .mockResolvedValue({ ok: false, retryAfterSeconds: 42 });
    const res = await requestOtpAction(
      {},
      makeFormData("current", "new@example.com"),
    );
    expect(res.error).toMatch(/Réessayez dans 42s/);
    expect(res.retryAfterSeconds).toBe(42);
    expect(insertSpy).not.toHaveBeenCalled();
    expect(sendTemplateMock).not.toHaveBeenCalled();
  });

  // F-056 — cap secondaire anti-harcèlement keyé sur newEmail (uniquement
  // step=new ; step=current envoie à l'ancienne adresse du user lui-même).
  it("F-056 step=new : cap secondaire newEmail dépassé → 429-like + audit rate_limit_exceeded", async () => {
    newEmailRateLimitMock = vi.fn<AnyAsyncFn>().mockResolvedValue({
      success: false,
      limit: 3,
      remaining: 0,
      reset: Date.now() + 1800_000,
    });
    const res = await requestOtpAction(
      {},
      makeFormData("new", "tiers@example.com"),
    );
    expect(res.error).toMatch(/cette adresse/);
    expect(insertSpy).not.toHaveBeenCalled();
    expect(sendTemplateMock).not.toHaveBeenCalled();
    expect(logAuthEventMock).toHaveBeenCalledWith({
      eventType: "rate_limit_exceeded",
      userId: "user-1",
      metadata: expect.objectContaining({
        route: "otp_new_email",
        target_email_masked: "ti***@example.com",
      }),
    });
  });

  it("F-056 step=current : cap secondaire newEmail PAS appliqué (envoi à l'ancienne adresse)", async () => {
    newEmailRateLimitMock = vi.fn<AnyAsyncFn>().mockResolvedValue({
      success: false,
      limit: 3,
      remaining: 0,
      reset: Date.now() + 1800_000,
    });
    const res = await requestOtpAction(
      {},
      makeFormData("current", "new@example.com"),
    );
    expect(res).toEqual({ ok: true });
    expect(newEmailRateLimitMock).not.toHaveBeenCalled();
  });
});

describe("requestOtpAction — DB / send errors", () => {
  it("invalidate fail → error technique, pas d'insert ni send", async () => {
    invalidateResponse = { error: { message: "DB timeout" } };
    const res = await requestOtpAction(
      {},
      makeFormData("current", "new@example.com"),
    );
    expect(res.error).toMatch(/Erreur technique/);
    expect(insertSpy).not.toHaveBeenCalled();
    expect(sendTemplateMock).not.toHaveBeenCalled();
    expect(logAuthEventMock).not.toHaveBeenCalled();
  });

  it("insert fail → error technique, pas de send ni audit log", async () => {
    insertResponse = { error: { message: "constraint violation" } };
    const res = await requestOtpAction(
      {},
      makeFormData("current", "new@example.com"),
    );
    expect(res.error).toMatch(/Erreur technique/);
    expect(sendTemplateMock).not.toHaveBeenCalled();
    expect(logAuthEventMock).not.toHaveBeenCalled();
  });

  it("send fail → error envoi, pas d'audit log", async () => {
    sendTemplateMock = vi
      .fn<AnyAsyncFn>()
      .mockResolvedValue({ ok: false, error: "Resend down" });
    const res = await requestOtpAction(
      {},
      makeFormData("current", "new@example.com"),
    );
    expect(res.error).toMatch(/Impossible/);
    expect(logAuthEventMock).not.toHaveBeenCalled();
  });
});
