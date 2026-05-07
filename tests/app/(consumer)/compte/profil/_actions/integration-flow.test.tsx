// =============================================================================
// Integration tests T-013 PR2 — flow A3 change_email full sequence
// =============================================================================
// Vérifie que les 3 server actions composent correctement bout en bout :
// requestOtp(current) → verifyOtp(current) → requestOtp(new) → verifyOtp(new)
// → completeEmailChange. Les unit tests (request-otp.test, verify-otp.test,
// complete-email-change.test) couvrent chaque action en isolation. Ce fichier
// exerce la séquence complète + les edge cases qui spannent plusieurs actions :
//
//   1. Happy path complet (5 actions chaînées, toutes ok=true)
//   2. Re-request invalidates previous (request#2 invalide row de request#1)
//   3. Collision UNIQUE sur completion (auth.admin.updateUserById fail)
//   4. Rate-limit hit après 3 requests rapides
// =============================================================================

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

type AnyAsyncFn = (...args: unknown[]) => Promise<unknown>;
type AnySyncFn = (...args: unknown[]) => unknown;

let sessionMock: Mock<AnyAsyncFn>;
let rateLimitMock: Mock<AnyAsyncFn>;
let sendTemplateMock: Mock<AnyAsyncFn>;
let logAuthEventMock: Mock<AnyAsyncFn>;
let verifyHashMock: Mock<AnyAsyncFn>;
let adminUpdateUserByIdMock: Mock<AnyAsyncFn>;
let userSignOutMock: Mock<AnyAsyncFn>;
let updateSpy: Mock<AnySyncFn>;
let insertSpy: Mock<AnySyncFn>;
let invalidateResponse: { error: { message: string } | null };
let insertResponse: { error: { message: string } | null };
let updateResponse: { error: { message: string } | null };
let selectMaybeSingleQueue: {
  data: Record<string, unknown> | null;
  error: unknown;
}[];

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: (...args: unknown[]) => sessionMock(...args),
}));

vi.mock("@/lib/email-change/rate-limit", () => ({
  checkOtpRateLimit: (...args: unknown[]) => rateLimitMock(...args),
}));

vi.mock("@/lib/resend/send", () => ({
  sendTemplate: (...args: unknown[]) => sendTemplateMock(...args),
}));

vi.mock("@/lib/audit-logs/log-auth-event", () => ({
  logAuthEvent: (...args: unknown[]) => logAuthEventMock(...args),
  extractRequestContext: () => ({ ipAddress: null, userAgent: null }),
}));

vi.mock("@/lib/email-change/hmac", () => ({
  hashOtp: () => Promise.resolve("dummy-hash"),
  verifyHash: (...args: unknown[]) => verifyHashMock(...args),
}));

vi.mock("next/headers", () => ({
  headers: () => {
    throw new Error("no headers in test");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
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
            is: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: () =>
                    Promise.resolve(
                      selectMaybeSingleQueue.shift() ?? {
                        data: null,
                        error: null,
                      },
                    ),
                }),
              }),
            }),
            order: () => ({
              limit: () => ({
                maybeSingle: () =>
                  Promise.resolve(
                    selectMaybeSingleQueue.shift() ?? {
                      data: null,
                      error: null,
                    },
                  ),
              }),
            }),
          }),
        }),
      }),
      update: (payload: unknown) => {
        updateSpy(payload);
        return {
          eq: (col: string, val: unknown) => {
            // Pour invalidate (UPDATE ... .eq().eq().is()) — chain
            // Pour complete users update (UPDATE .eq("id", ...)) — terminal
            if (col === "id") {
              return Promise.resolve(updateResponse);
            }
            return {
              eq: () => ({
                is: () => Promise.resolve(invalidateResponse),
              }),
            };
          },
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
import { verifyOtpAction } from "@/app/(consumer)/compte/profil/_actions/verify-otp";
import { completeEmailChangeAction } from "@/app/(consumer)/compte/profil/_actions/complete-email-change";

function makeRequestFD(step: "current" | "new", newEmail: string): FormData {
  const fd = new FormData();
  fd.set("step", step);
  fd.set("newEmail", newEmail);
  return fd;
}

function makeVerifyFD(step: "current" | "new", code: string): FormData {
  const fd = new FormData();
  fd.set("step", step);
  fd.set("code", code);
  return fd;
}

function makeCompleteFD(newEmail: string): FormData {
  const fd = new FormData();
  fd.set("newEmail", newEmail);
  return fd;
}

function makeOtpRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-uuid-1",
    user_id: "user-1",
    step: "current",
    email: "old@example.com",
    code_hash: "fake-hash",
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
  rateLimitMock = vi.fn<AnyAsyncFn>().mockResolvedValue({ ok: true });
  sendTemplateMock = vi
    .fn<AnyAsyncFn>()
    .mockResolvedValue({ ok: true, id: "resend-id" });
  logAuthEventMock = vi.fn<AnyAsyncFn>().mockResolvedValue(undefined);
  verifyHashMock = vi.fn<AnyAsyncFn>().mockResolvedValue(true);
  adminUpdateUserByIdMock = vi
    .fn<AnyAsyncFn>()
    .mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  userSignOutMock = vi.fn<AnyAsyncFn>().mockResolvedValue({ error: null });
  updateSpy = vi.fn<AnySyncFn>();
  insertSpy = vi.fn<AnySyncFn>();
  invalidateResponse = { error: null };
  insertResponse = { error: null };
  updateResponse = { error: null };
  selectMaybeSingleQueue = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Integration flow — happy path complet", () => {
  it("5 actions chaînées : tous les ok=true + audit logs cohérents", async () => {
    // Step 1 : requestOtp(current)
    const res1 = await requestOtpAction(
      {},
      makeRequestFD("current", "new@example.com"),
    );
    expect(res1).toEqual({ ok: true });
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(insertSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        step: "current",
        email: "old@example.com",
      }),
    );

    // Step 2 : verifyOtp(current) — DB renvoie la row insérée
    selectMaybeSingleQueue = [
      { data: makeOtpRow({ step: "current" }), error: null },
    ];
    const res2 = await verifyOtpAction({}, makeVerifyFD("current", "123456"));
    expect(res2).toEqual({ ok: true });

    // Step 3 : requestOtp(new)
    const res3 = await requestOtpAction(
      {},
      makeRequestFD("new", "new@example.com"),
    );
    expect(res3).toEqual({ ok: true });
    expect(insertSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        step: "new",
        email: "new@example.com",
      }),
    );

    // Step 4 : verifyOtp(new) — DB renvoie la row step=new insérée
    selectMaybeSingleQueue = [
      {
        data: makeOtpRow({ step: "new", email: "new@example.com" }),
        error: null,
      },
    ];
    const res4 = await verifyOtpAction({}, makeVerifyFD("new", "654321"));
    expect(res4).toEqual({ ok: true });

    // Step 5 : completeEmailChange
    selectMaybeSingleQueue = [
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
          email: "new@example.com",
        },
        error: null,
      },
    ];
    const res5 = await completeEmailChangeAction(
      {},
      makeCompleteFD("new@example.com"),
    );
    expect(res5).toEqual({ ok: true });
    expect(adminUpdateUserByIdMock).toHaveBeenCalledWith("user-1", {
      email: "new@example.com",
    });
    expect(userSignOutMock).toHaveBeenCalledWith({ scope: "others" });

    // Audit logs cumulés : 2 requested + 2 verified + 1 completed = 5
    expect(logAuthEventMock).toHaveBeenCalledTimes(5);
    const events = logAuthEventMock.mock.calls.map(
      (call) => (call[0] as { eventType: string }).eventType,
    );
    expect(events).toEqual([
      "account_otp_requested",
      "account_otp_verified",
      "account_otp_requested",
      "account_otp_verified",
      "account_email_change_completed",
    ]);
  });
});

describe("Integration flow — edge cases cross-actions", () => {
  it("collision UNIQUE sur completion : updateUserById fail email_collision propagé", async () => {
    adminUpdateUserByIdMock = vi.fn<AnyAsyncFn>().mockResolvedValue({
      data: null,
      error: { message: "email_exists: already registered" },
    });
    selectMaybeSingleQueue = [
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
          email: "taken@example.com",
        },
        error: null,
      },
    ];
    const res = await completeEmailChangeAction(
      {},
      makeCompleteFD("taken@example.com"),
    );
    expect(res).toEqual({ ok: false, reason: "email_collision" });
    expect(updateSpy).not.toHaveBeenCalled(); // public.users update non atteint
    expect(userSignOutMock).not.toHaveBeenCalled(); // signOut non atteint
    expect(logAuthEventMock).not.toHaveBeenCalled(); // pas d'audit completion
  });

  it("re-request : 2 requestOtp consécutifs → INVALIDATE + INSERT chaque fois", async () => {
    // Premier request
    const res1 = await requestOtpAction(
      {},
      makeRequestFD("current", "new@example.com"),
    );
    expect(res1).toEqual({ ok: true });
    const firstInsertCount = insertSpy.mock.calls.length;
    const firstUpdateCount = updateSpy.mock.calls.length;

    // Deuxième request (l'user clique "Renvoyer")
    const res2 = await requestOtpAction(
      {},
      makeRequestFD("current", "new@example.com"),
    );
    expect(res2).toEqual({ ok: true });

    // Chaque request fait UN invalidate (UPDATE) + UN insert
    expect(insertSpy.mock.calls.length).toBe(firstInsertCount + 1);
    expect(updateSpy.mock.calls.length).toBe(firstUpdateCount + 1);
    // Audit log appelé 2 fois (1 par request)
    expect(logAuthEventMock).toHaveBeenCalledTimes(2);
  });

  it("rate-limit hit : 4ème requestOtp en 60s refusé sans toucher DB", async () => {
    // Premier 3 requests OK
    rateLimitMock = vi.fn<AnyAsyncFn>().mockResolvedValue({ ok: true });
    for (let i = 0; i < 3; i++) {
      await requestOtpAction(
        {},
        makeRequestFD("current", "new@example.com"),
      );
    }
    expect(insertSpy).toHaveBeenCalledTimes(3);

    // 4ème : rate-limit retourne ok=false
    rateLimitMock = vi
      .fn<AnyAsyncFn>()
      .mockResolvedValue({ ok: false, retryAfterSeconds: 42 });
    const res = await requestOtpAction(
      {},
      makeRequestFD("current", "new@example.com"),
    );
    expect(res.error).toMatch(/Réessayez dans 42s/);
    expect(res.retryAfterSeconds).toBe(42);
    // Pas d'INSERT supplémentaire
    expect(insertSpy).toHaveBeenCalledTimes(3);
  });

  it("verify échoue avec mauvais code → pas de transition, pas de complete", async () => {
    selectMaybeSingleQueue = [
      { data: makeOtpRow({ attempts: 0 }), error: null },
    ];
    verifyHashMock = vi.fn<AnyAsyncFn>().mockResolvedValue(false);
    const res = await verifyOtpAction({}, makeVerifyFD("current", "999999"));
    expect(res).toEqual({
      ok: false,
      reason: "invalid",
      attemptsRemaining: 4,
    });
    // Si l'UI ne gère pas la transition, completeEmailChange ne sera jamais
    // appelé (responsabilité côté ChangeEmailSection useEffect — chaque
    // phase a son useFormState dédié verifyCurrentState/verifyNewState
    // pour éviter le re-fire prématuré, cf. tests/e2e/change-email.spec.ts).
    expect(adminUpdateUserByIdMock).not.toHaveBeenCalled();
  });

  // Defense in depth pour le bug UI détecté au premier run E2E Playwright
  // (cf. tests/e2e/change-email.spec.ts) : avant le fix de séparation des
  // useFormState verifyCurrentState/verifyNewState dans ChangeEmailSection.tsx,
  // le useEffect chaining déclenchait completeEmailChange dès la transition
  // step verify-current → verify-new, sans que verifyOtp(step=new) ait tourné
  // (verifyState.ok restait à true entre les 2 phases — trace t0→t8 dans
  // l'investigation Playwright). La fix UI sépare les états, mais ce test
  // verrouille la défense côté serveur : même si une régression UI ré-introduit
  // le bug, completeEmailChange doit refuser avec reason='flow_invalid' tant
  // que la row step=new n'est pas consumed_at NOT NULL.
  it("completeEmailChange refuse si verifyOtp(new) pas consommé récemment (defense in depth pour bug UI Playwright t0→t8)", async () => {
    // Step 1 : requestOtp(current) ok
    const res1 = await requestOtpAction(
      {},
      makeRequestFD("current", "new@example.com"),
    );
    expect(res1).toEqual({ ok: true });

    // Step 2 : verifyOtp(current) ok → row step=current consumed
    selectMaybeSingleQueue = [
      { data: makeOtpRow({ step: "current" }), error: null },
    ];
    const res2 = await verifyOtpAction({}, makeVerifyFD("current", "123456"));
    expect(res2).toEqual({ ok: true });

    // Step 3 : requestOtp(new) ok → row step=new INSERT mais PAS consumed
    const res3 = await requestOtpAction(
      {},
      makeRequestFD("new", "new@example.com"),
    );
    expect(res3).toEqual({ ok: true });

    // Step 4 : completeEmailChange APPELÉ DIRECTEMENT (skip verifyOtp(new)).
    // Mock le defensive recheck DB : row step=current consumed, row step=new
    // PAS consumed (consumed_at IS NULL) — état incohérent que l'UI buggé
    // produirait avant le fix.
    selectMaybeSingleQueue = [
      {
        data: {
          consumed_at: new Date().toISOString(),
          email: "old@example.com",
        },
        error: null,
      },
      {
        data: { consumed_at: null, email: "new@example.com" },
        error: null,
      },
    ];
    const res4 = await completeEmailChangeAction(
      {},
      makeCompleteFD("new@example.com"),
    );
    expect(res4).toEqual({ ok: false, reason: "flow_invalid" });

    // Aucune mutation : ni auth.users.email, ni public.users, ni signOut.
    expect(adminUpdateUserByIdMock).not.toHaveBeenCalled();
    expect(userSignOutMock).not.toHaveBeenCalled();
  });
});
