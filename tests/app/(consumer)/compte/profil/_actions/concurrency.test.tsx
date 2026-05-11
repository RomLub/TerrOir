// =============================================================================
// Concurrency & state-machine edge case tests T-013 PR2 C2.12
// =============================================================================
// Tests qui couvrent les transitions entre actions et les comportements
// race-condition simulés via mock state. Complémentaires aux unit tests
// (chaque action en isolation) et au integration-flow (happy path + edge
// cross-action). Focus sur :
//
//   1. Verify avec code de l'ancienne row après re-request : reason=invalid
//      (verifyHash retourne false car code_hash actuel = nouveau code)
//   2. Cap attempts atteint puis nouveau verify : attempts_exceeded à
//      perpétuité tant que pas re-request (pre-check défensif)
//   3. completeEmailChange avant verify-new : flow_invalid (recheck step=new)
//   4. Email tampering : verify step=new pour email A puis complete avec
//      email B → flow_invalid
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
  // F-041 (audit P0 sweep) : complete-email-change importe lib/stripe/server
  // pour re-sync l'email Stripe Customer. Stub la clé pour les tests qui
  // n'exercent pas le path Stripe (mock @/lib/stripe/server ci-dessous).
  process.env.STRIPE_SECRET_KEY =
    process.env.STRIPE_SECRET_KEY ?? "sk_test_stub";
  // F-037 / F-062 — complete-email-change tire @/lib/resend/send via
  // notification email post-change. Stub URLs nécessaires pour templates
  // layout au module-load.
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://www.terroir-local.fr";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.terroir-local.fr";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "https://pro.terroir-local.fr";
});

vi.mock("@/lib/stripe/server", () => ({
  stripe: {
    customers: { update: vi.fn().mockResolvedValue({}) },
  },
}));

// F-037 / F-062 — mock sendTemplate pour éviter throw RESEND_API_KEY au
// module-load. Helper fail-safe côté action (warn si KO, pas de revert).
vi.mock("@/lib/resend/send", () => ({
  sendTemplate: vi.fn().mockResolvedValue({ ok: true, id: "msg_test" }),
}));

type AnyAsyncFn = (...args: unknown[]) => Promise<unknown>;
type AnySyncFn = (...args: unknown[]) => unknown;

let sessionMock: Mock<AnyAsyncFn>;
let logAuthEventMock: Mock<AnyAsyncFn>;
let verifyHashMock: Mock<AnyAsyncFn>;
let adminUpdateUserByIdMock: Mock<AnyAsyncFn>;
let userSignOutMock: Mock<AnyAsyncFn>;
let updateSpy: Mock<AnySyncFn>;
let updateResponse: { error: { message: string } | null };
let selectQueue: { data: Record<string, unknown> | null; error: unknown }[];

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

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      signOut: (...args: unknown[]) => userSignOutMock(...args),
    },
  }),
}));

// F-024 (audit P0 sweep) : verify-otp invoke admin.rpc('increment_otp_attempts')
// pour incrément atomique race-safe. Mock retourne attempts incrémenté ou null
// si guard cap atteint. Le test peut surcharger via incrementOtpRpcQueue.
let incrementOtpRpcQueue: { data: unknown; error: unknown }[] = [];

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    auth: {
      admin: {
        updateUserById: (...args: unknown[]) => adminUpdateUserByIdMock(...args),
      },
    },
    rpc: (_name: string, _params: unknown) =>
      Promise.resolve(
        incrementOtpRpcQueue.shift() ?? { data: null, error: null },
      ),
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            is: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: () =>
                    Promise.resolve(
                      selectQueue.shift() ?? { data: null, error: null },
                    ),
                }),
              }),
            }),
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

import { verifyOtpAction } from "@/app/(consumer)/compte/profil/_actions/verify-otp";
import { completeEmailChangeAction } from "@/app/(consumer)/compte/profil/_actions/complete-email-change";

function makeVerifyFD(step: string, code: string): FormData {
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
  logAuthEventMock = vi.fn<AnyAsyncFn>().mockResolvedValue(undefined);
  verifyHashMock = vi.fn<AnyAsyncFn>().mockResolvedValue(true);
  adminUpdateUserByIdMock = vi
    .fn<AnyAsyncFn>()
    .mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  userSignOutMock = vi.fn<AnyAsyncFn>().mockResolvedValue({ error: null });
  updateSpy = vi.fn<AnySyncFn>();
  updateResponse = { error: null };
  selectQueue = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Concurrency — verify avec code obsolète post re-request", () => {
  it("après re-request, verify avec ancien code → reason=invalid (hash mismatch)", async () => {
    // Mock : la row actuelle a un code_hash = NOUVEAU code (re-request a
    // rotaté). L'ancien code soumis ne va pas matcher.
    selectQueue = [
      { data: makeOtpRow({ code_hash: "new-hash-after-rerequest" }), error: null },
    ];
    verifyHashMock = vi.fn<AnyAsyncFn>().mockResolvedValue(false);
    // F-024 (audit P0 sweep) : verify-otp utilise RPC SECDEF
    // increment_otp_attempts_if_below_cap. Mock retourne new_attempts=1
    // (premier wrong attempt sur cette row).
    incrementOtpRpcQueue = [{ data: [{ new_attempts: 1 }], error: null }];

    const res = await verifyOtpAction({}, makeVerifyFD("current", "111111"));
    expect(res).toEqual({
      ok: false,
      reason: "invalid",
      attemptsRemaining: 4,
    });
    expect(verifyHashMock).toHaveBeenCalledWith(
      "111111",
      "new-hash-after-rerequest",
    );
  });

  it("après re-request, verify avec code de l'ancien row consumed → reason=no_active", async () => {
    // L'ancien row est consumed_at NOT NULL post-re-request (invalidate).
    // Le SELECT ne trouve aucune row active (filtrage IS NULL).
    selectQueue = [{ data: null, error: null }];
    const res = await verifyOtpAction({}, makeVerifyFD("current", "111111"));
    expect(res).toEqual({ ok: false, reason: "no_active" });
  });
});

describe("Concurrency — cap attempts", () => {
  it("attempts=5 puis nouveau verify (sans re-request) → attempts_exceeded à perpétuité", async () => {
    // Premier appel : row à attempts=5 (cap atteint pré-check)
    selectQueue = [{ data: makeOtpRow({ attempts: 5 }), error: null }];
    const res1 = await verifyOtpAction({}, makeVerifyFD("current", "111111"));
    expect(res1).toEqual({ ok: false, reason: "attempts_exceeded" });
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ consumed_at: expect.any(String) }),
    );

    // Deuxième appel sans re-request : row consumed (set par le 1er call)
    // → SELECT renvoie null → no_active
    selectQueue = [{ data: null, error: null }];
    const res2 = await verifyOtpAction({}, makeVerifyFD("current", "111111"));
    expect(res2).toEqual({ ok: false, reason: "no_active" });
  });

  it("4 wrong attempts puis 5th wrong → attempts_exceeded sur le 5th (RPC consume atomique)", async () => {
    // F-024 (audit P0 sweep) : 5th tentative — RPC retourne new_attempts=5
    // qui atteint le cap. La RPC SECDEF consume la row atomiquement côté
    // SQL ; pas de UPDATE manuel TS supplémentaire.
    selectQueue = [{ data: makeOtpRow({ attempts: 4 }), error: null }];
    verifyHashMock = vi.fn<AnyAsyncFn>().mockResolvedValue(false);
    incrementOtpRpcQueue = [{ data: [{ new_attempts: 5 }], error: null }];

    const res = await verifyOtpAction({}, makeVerifyFD("current", "999999"));
    expect(res).toEqual({ ok: false, reason: "attempts_exceeded" });
  });
});

describe("Concurrency — complete prématuré", () => {
  it("completeEmailChange avant verify-new → flow_invalid (step=new row absente)", async () => {
    // step=current consumed OK, step=new row n'existe pas
    selectQueue = [
      {
        data: {
          consumed_at: new Date().toISOString(),
          email: "old@example.com",
        },
        error: null,
      },
      { data: null, error: null }, // step=new pas trouvée
    ];
    const res = await completeEmailChangeAction(
      {},
      makeCompleteFD("new@example.com"),
    );
    expect(res).toEqual({ ok: false, reason: "flow_invalid" });
    expect(adminUpdateUserByIdMock).not.toHaveBeenCalled();
    expect(userSignOutMock).not.toHaveBeenCalled();
  });

  it("verify-new fait mais consumed_at NULL (race detected) → flow_invalid", async () => {
    selectQueue = [
      {
        data: {
          consumed_at: new Date().toISOString(),
          email: "old@example.com",
        },
        error: null,
      },
      { data: { consumed_at: null, email: "new@example.com" }, error: null },
    ];
    const res = await completeEmailChangeAction(
      {},
      makeCompleteFD("new@example.com"),
    );
    expect(res).toEqual({ ok: false, reason: "flow_invalid" });
  });
});

describe("Concurrency — email tampering anti-pattern", () => {
  it("verify-new pour email A, complete avec email B → flow_invalid", async () => {
    // L'attaquant a vérifié OTP pour "alice@example.com" puis tente de
    // soumettre completeEmailChange avec "bob@example.com" pour s'approprier
    // bob's email. Le defensive recheck détecte le mismatch.
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
          email: "alice@example.com", // verifié pour alice
        },
        error: null,
      },
    ];
    const res = await completeEmailChangeAction(
      {},
      makeCompleteFD("bob@example.com"), // tente de prendre bob
    );
    expect(res).toEqual({ ok: false, reason: "flow_invalid" });
    expect(adminUpdateUserByIdMock).not.toHaveBeenCalled();
  });
});
