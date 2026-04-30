import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

vi.hoisted(() => {
  process.env.SUPPORT_EMAIL = process.env.SUPPORT_EMAIL ?? "admin@terroir-local.fr";
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
});

vi.mock("@/lib/audit-logs/log-payment-event", () => ({
  logPaymentEvent: vi.fn(),
}));
vi.mock("@/lib/resend/send", () => ({
  sendTemplate: vi.fn().mockResolvedValue({ ok: true, id: "resend_id" }),
}));
const { mockWaitUntil } = vi.hoisted(() => ({ mockWaitUntil: vi.fn() }));
vi.mock("@vercel/functions", () => ({ waitUntil: mockWaitUntil }));
vi.mock("@/lib/resend/templates/admin-dispute-action-required", () => ({
  default: () => null,
  subject: () => "Subject mock",
}));

import { syncStripeDisputeCreated } from "@/lib/stripe/handle-dispute-created";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";
import { sendTemplate } from "@/lib/resend/send";

type Resp = { data?: unknown; error?: unknown };

interface Fixture {
  orderResp?: Resp;
  disputeInsertResp?: Resp;
  notifResp?: Resp;
  consumerResp?: Resp;
}

type Captured = {
  from: string[];
  insert: unknown[];
  eq: Array<[string, unknown]>;
};

function makeSupabase(fixture: Fixture = {}): {
  client: SupabaseClient;
  captured: Captured;
} {
  const captured: Captured = { from: [], insert: [], eq: [] };

  function ordersBuilder() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    b.select = () => b;
    b.eq = (col: string, val: unknown) => {
      captured.eq.push([col, val]);
      return b;
    };
    b.maybeSingle = () =>
      Promise.resolve(fixture.orderResp ?? { data: null, error: null });
    return b;
  }

  function disputesBuilder() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    b.insert = (payload: unknown) => {
      captured.insert.push(payload);
      return Promise.resolve(fixture.disputeInsertResp ?? { data: null, error: null });
    };
    return b;
  }

  function notificationsBuilder() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    b.insert = (payload: unknown) => {
      captured.insert.push(payload);
      return Promise.resolve(fixture.notifResp ?? { data: null, error: null });
    };
    return b;
  }

  function usersBuilder() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    b.select = () => b;
    b.eq = (col: string, val: unknown) => {
      captured.eq.push([col, val]);
      return b;
    };
    b.maybeSingle = () =>
      Promise.resolve(fixture.consumerResp ?? { data: null, error: null });
    return b;
  }

  const client = {
    from: (table: string) => {
      captured.from.push(table);
      if (table === "orders") return ordersBuilder();
      if (table === "disputes") return disputesBuilder();
      if (table === "notifications") return notificationsBuilder();
      if (table === "users") return usersBuilder();
      throw new Error(`unexpected from(${table})`);
    },
  } as unknown as SupabaseClient;

  return { client, captured };
}

function makeDispute(overrides: Partial<Stripe.Dispute> = {}): Stripe.Dispute {
  return {
    id: "dp_test_1",
    object: "dispute",
    charge: "ch_test_1",
    payment_intent: "pi_test_1",
    amount: 5000,
    currency: "eur",
    reason: "fraudulent",
    status: "needs_response",
    evidence_details: { due_by: 1700000000 },
    ...overrides,
  } as unknown as Stripe.Dispute;
}

const ORDER_FIXTURE = {
  data: {
    id: "order-42",
    code_commande: "TER-2026-0042",
    consumer_id: "user-7",
  },
  error: null,
};
const CONSUMER_FIXTURE = {
  data: { email: "alice@example.com" },
  error: null,
};

beforeEach(() => {
  vi.mocked(logPaymentEvent).mockReset().mockResolvedValue(undefined);
  vi.mocked(sendTemplate).mockReset().mockResolvedValue({ ok: true, id: "resend_id" });
  mockWaitUntil.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("syncStripeDisputeCreated — path nominal (created)", () => {
  it("INSERT public.disputes + audit log + email envoyé", async () => {
    const { client, captured } = makeSupabase({
      orderResp: ORDER_FIXTURE,
      consumerResp: CONSUMER_FIXTURE,
    });

    const out = await syncStripeDisputeCreated(makeDispute(), client);

    expect(out.result).toBe("created");
    expect(out.orderId).toBe("order-42");
    expect(captured.from).toContain("disputes");

    const disputesInsert = captured.insert.find(
      (p) => (p as { stripe_dispute_id?: string }).stripe_dispute_id === "dp_test_1",
    ) as Record<string, unknown>;
    expect(disputesInsert).toMatchObject({
      order_id: "order-42",
      stripe_dispute_id: "dp_test_1",
      stripe_charge_id: "ch_test_1",
      status: "needs_response",
      reason: "fraudulent",
      amount: 50,
      currency: "eur",
    });
    expect(disputesInsert.evidence_due_by).toBeTruthy();
  });

  it("logPaymentEvent('stripe_dispute') metadata étendue (requires_action + dispute_status + order_match)", async () => {
    const { client } = makeSupabase({
      orderResp: ORDER_FIXTURE,
      consumerResp: CONSUMER_FIXTURE,
    });

    await syncStripeDisputeCreated(makeDispute(), client);

    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith({
      eventType: "stripe_dispute",
      userId: "user-7",
      metadata: expect.objectContaining({
        dispute_id: "dp_test_1",
        order_id: "order-42",
        requires_action: true,
        dispute_status: "needs_response",
        evidence_due_by: 1700000000,
        order_match: true,
      }),
    });
  });

  it("INSERT notifications placeholder + waitUntil(sendTemplate(... to=SUPPORT_EMAIL))", async () => {
    const { client, captured } = makeSupabase({
      orderResp: ORDER_FIXTURE,
      consumerResp: CONSUMER_FIXTURE,
    });

    await syncStripeDisputeCreated(makeDispute(), client);

    const notif = captured.insert.find(
      (p) => (p as { template?: string }).template === "admin_dispute_action_required",
    );
    expect(notif).toBeDefined();
    expect(mockWaitUntil).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendTemplate)).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "admin@terroir-local.fr",
        template: "admin_dispute_action_required",
      }),
    );
  });
});

describe("syncStripeDisputeCreated — no_order_match", () => {
  it("payment_intent introuvable en DB → result='no_order_match' + warn log", async () => {
    const { client, captured } = makeSupabase({
      orderResp: { data: null, error: null },
    });
    const warn = vi.spyOn(console, "warn");

    const out = await syncStripeDisputeCreated(makeDispute(), client);

    expect(out.result).toBe("no_order_match");
    expect(out.orderId).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[STRIPE_DISPUTE_CREATED_NO_ORDER]"),
    );
    // Pas d'INSERT disputes (FK order_id NOT NULL impossible).
    expect(captured.from).not.toContain("disputes");
  });

  it("no_order_match : audit log poussé quand même avec order_match=false", async () => {
    const { client } = makeSupabase({
      orderResp: { data: null, error: null },
    });

    await syncStripeDisputeCreated(makeDispute(), client);

    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith({
      eventType: "stripe_dispute",
      metadata: expect.objectContaining({
        order_match: false,
        requires_action: true,
      }),
    });
  });
});

describe("syncStripeDisputeCreated — duplicate (rejouage défensif)", () => {
  it("INSERT 23505 → result='duplicate' sans envoi email", async () => {
    const { client } = makeSupabase({
      orderResp: ORDER_FIXTURE,
      disputeInsertResp: {
        error: { code: "23505", message: "duplicate key" },
      },
    });

    const out = await syncStripeDisputeCreated(makeDispute(), client);

    expect(out.result).toBe("duplicate");
    expect(out.orderId).toBe("order-42");
    expect(mockWaitUntil).not.toHaveBeenCalled();
    expect(vi.mocked(sendTemplate)).not.toHaveBeenCalled();
  });
});
