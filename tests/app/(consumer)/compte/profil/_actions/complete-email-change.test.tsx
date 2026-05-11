import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";

// F-037 — la nouvelle dépendance @/lib/resend/templates/email-changed-notice
// tire transitive `lib/resend/templates/layout.tsx` qui throw au module-load
// si NEXT_PUBLIC_APP_URL absent. Stub hoisted aligné pattern projet
// (cf. tests/app/(consumer)/compte/profil/_actions/verify-otp.test.tsx).
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://www.terroir-local.fr";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.terroir-local.fr";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "https://pro.terroir-local.fr";
});

type AnyAsyncFn = (...args: unknown[]) => Promise<unknown>;
type AnySyncFn = (...args: unknown[]) => unknown;

let sessionMock: Mock<AnyAsyncFn>;
let logAuthEventMock: Mock<AnyAsyncFn>;
let adminUpdateUserByIdMock: Mock<AnyAsyncFn>;
let userSignOutMock: Mock<AnyAsyncFn>;
let updateSpy: Mock<AnySyncFn>;
let updateResponse: {
  data: { stripe_customer_id: string | null } | null;
  error: { message: string } | null;
};
// F-041 — Stripe customer update mock + response data including
// stripe_customer_id retourné par la chaîne update().select().maybeSingle().
let stripeCustomersUpdateMock: Mock<AnyAsyncFn>;
// SELECT response queue : the action does 2 SELECTs (current + new)
let selectQueue: { data: Record<string, unknown> | null; error: unknown }[] = [];

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: (...args: unknown[]) => sessionMock(...args),
}));

vi.mock("@/lib/audit-logs/log-auth-event", () => ({
  logAuthEvent: (...args: unknown[]) => logAuthEventMock(...args),
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
        // F-041 — chaîne update().eq().select('stripe_customer_id').maybeSingle()
        // pour récupérer le stripe_customer_id post-UPDATE et re-sync l'email
        // Stripe Customer.
        return {
          eq: () => ({
            select: () => ({
              maybeSingle: () => Promise.resolve(updateResponse),
            }),
          }),
        };
      },
    }),
  }),
}));

// F-041 — mock Stripe SDK pour intercepter customers.update.
vi.mock("@/lib/stripe/server", () => ({
  stripe: {
    customers: {
      update: (...args: unknown[]) => stripeCustomersUpdateMock(...args),
    },
  },
}));

// F-037 — mock Resend sendTemplate pour intercepter la notification
// post-completion à l'ancienne adresse.
let sendTemplateMock: Mock<AnyAsyncFn>;
vi.mock("@/lib/resend/send", () => ({
  sendTemplate: (...args: unknown[]) => sendTemplateMock(...args),
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
  // F-041 — par défaut, public.users a un stripe_customer_id (path commun
  // pour les consumers ayant déjà passé commande / configuré paiement).
  updateResponse = {
    data: { stripe_customer_id: "cus_default" },
    error: null,
  };
  stripeCustomersUpdateMock = vi
    .fn<AnyAsyncFn>()
    .mockResolvedValue({ id: "cus_default", email: "new@example.com" });
  sendTemplateMock = vi
    .fn<AnyAsyncFn>()
    .mockResolvedValue({ ok: true, id: "msg_default" });
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
    updateResponse = {
      data: null,
      error: { message: "unique constraint violation" },
    };
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

// F-041 (audit pré-launch 2026-05-11) — re-sync email Stripe Customer après
// changement d'email DB. Fail-open : si Stripe API down, on log mais on
// continue le flow (l'email DB est déjà OK).
describe("completeEmailChangeAction — F-041 Stripe customer email re-sync", () => {
  it("stripe_customer_id présent → stripe.customers.update appelé avec newEmail", async () => {
    updateResponse = {
      data: { stripe_customer_id: "cus_test_123" },
      error: null,
    };
    const res = await completeEmailChangeAction(
      {},
      makeFormData("new@example.com"),
    );

    expect(res).toEqual({ ok: true });
    expect(stripeCustomersUpdateMock).toHaveBeenCalledTimes(1);
    expect(stripeCustomersUpdateMock).toHaveBeenCalledWith("cus_test_123", {
      email: "new@example.com",
    });
  });

  it("stripe_customer_id null → stripe.customers.update NON appelé", async () => {
    updateResponse = {
      data: { stripe_customer_id: null },
      error: null,
    };
    const res = await completeEmailChangeAction(
      {},
      makeFormData("new@example.com"),
    );

    expect(res).toEqual({ ok: true });
    expect(stripeCustomersUpdateMock).not.toHaveBeenCalled();
  });

  it("stripe API throw → log warn fail-open, flow continue ok=true", async () => {
    updateResponse = {
      data: { stripe_customer_id: "cus_test_fail" },
      error: null,
    };
    stripeCustomersUpdateMock = vi
      .fn<AnyAsyncFn>()
      .mockRejectedValue(new Error("Stripe API down"));

    const res = await completeEmailChangeAction(
      {},
      makeFormData("new@example.com"),
    );

    expect(res).toEqual({ ok: true });
    // L'audit log + signOut continuent malgré l'erreur Stripe.
    expect(logAuthEventMock).toHaveBeenCalled();
  });
});

describe("completeEmailChangeAction — F-037 notification post-completion oldEmail", () => {
  it("envoie email-changed-notice à l'ancienne adresse après succès", async () => {
    const res = await completeEmailChangeAction(
      {},
      makeFormData("new@example.com"),
    );

    expect(res).toEqual({ ok: true });
    expect(sendTemplateMock).toHaveBeenCalledTimes(1);
    const call = sendTemplateMock.mock.calls[0]![0] as {
      to: string;
      userId: string | null;
      template: string;
      metadata?: Record<string, unknown>;
    };
    expect(call.to).toBe("old@example.com");
    expect(call.userId).toBeNull();
    expect(call.template).toBe("email_changed_notice");
    expect(call.metadata).toMatchObject({
      user_id: "user-1",
    });
  });

  it("envoi notice échoue → log warn fail-open, flow continue ok=true", async () => {
    sendTemplateMock = vi
      .fn<AnyAsyncFn>()
      .mockResolvedValue({ ok: false, error: "Resend down" });

    const res = await completeEmailChangeAction(
      {},
      makeFormData("new@example.com"),
    );

    expect(res).toEqual({ ok: true });
    expect(logAuthEventMock).toHaveBeenCalled();
  });
});
