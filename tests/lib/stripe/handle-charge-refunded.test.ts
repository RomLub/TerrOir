import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import type { ChainableMockBuilder } from "./_mock-builder";

vi.mock("@/lib/audit-logs/log-payment-event", () => ({
  logPaymentEvent: vi.fn(),
}));

import { syncStripeChargeRefunded } from "@/lib/stripe/handle-charge-refunded";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";

type Resp = { data?: unknown; error?: unknown };

interface Fixture {
  orderResp?: Resp;
}

type Captured = {
  from: string[];
  eq: Array<[string, unknown]>;
};

function makeSupabase(fixture: Fixture = {}): {
  client: SupabaseClient;
  captured: Captured;
} {
  const captured: Captured = { from: [], eq: [] };

  function ordersBuilder() {
    const b: ChainableMockBuilder = {};
    b.select = () => b;
    b.eq = (col: string, val: unknown) => {
      captured.eq.push([col, val]);
      return b;
    };
    b.maybeSingle = () =>
      Promise.resolve(fixture.orderResp ?? { data: null, error: null });
    return b;
  }

  const client = {
    from: (table: string) => {
      captured.from.push(table);
      if (table === "orders") return ordersBuilder();
      throw new Error(`unexpected from(${table})`);
    },
  } as unknown as SupabaseClient;

  return { client, captured };
}

function makeCharge(overrides: Partial<Stripe.Charge> = {}): Stripe.Charge {
  return {
    id: "ch_test_1",
    object: "charge",
    amount: 5000,
    amount_refunded: 5000,
    currency: "eur",
    payment_intent: "pi_test_1",
    refunded: true,
    refunds: {
      object: "list",
      data: [{ id: "re_test_1" } as Stripe.Refund],
      has_more: false,
      url: "/v1/charges/ch_test_1/refunds",
    },
    ...overrides,
  } as unknown as Stripe.Charge;
}

beforeEach(() => {
  vi.mocked(logPaymentEvent).mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("syncStripeChargeRefunded — path nominal (logged + order_match)", () => {
  it("Charge avec PI lookup match order → audit log avec metadata enrichie", async () => {
    const { client } = makeSupabase({
      orderResp: {
        data: { id: "order-42", consumer_id: "user-7" },
        error: null,
      },
    });

    const out = await syncStripeChargeRefunded(makeCharge(), client);

    expect(out.result).toBe("logged");
    expect(out.orderId).toBe("order-42");

    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith({
      eventType: "stripe_charge_refunded_settled",
      userId: "user-7",
      metadata: expect.objectContaining({
        charge_id: "ch_test_1",
        payment_intent_id: "pi_test_1",
        order_id: "order-42",
        amount: 5000,
        amount_refunded: 5000,
        currency: "eur",
        refunded: true,
        refund_count: 1,
        last_refund_id: "re_test_1",
        order_match: true,
      }),
    });
  });
});

describe("syncStripeChargeRefunded — no_order_match (PI orphelin)", () => {
  it("Charge avec PI introuvable → audit log avec order_match=false", async () => {
    const { client } = makeSupabase({ orderResp: { data: null, error: null } });

    const out = await syncStripeChargeRefunded(makeCharge(), client);

    expect(out.result).toBe("no_order_match");
    expect(out.orderId).toBeNull();

    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith({
      eventType: "stripe_charge_refunded_settled",
      metadata: expect.objectContaining({
        charge_id: "ch_test_1",
        order_match: false,
        refund_count: 1,
      }),
    });
  });
});

describe("syncStripeChargeRefunded — refund partiel", () => {
  it("Charge avec amount_refunded < amount → metadata reflète le refund partiel", async () => {
    const { client } = makeSupabase({
      orderResp: {
        data: { id: "order-99", consumer_id: null },
        error: null,
      },
    });

    const partialCharge = makeCharge({
      amount: 5000,
      amount_refunded: 2500,
      refunded: false,
      refunds: {
        object: "list",
        data: [{ id: "re_partial_1" } as Stripe.Refund],
        has_more: false,
        url: "/v1/charges/ch_test_1/refunds",
      } as never,
    });

    await syncStripeChargeRefunded(partialCharge, client);

    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith({
      eventType: "stripe_charge_refunded_settled",
      userId: null,
      metadata: expect.objectContaining({
        amount: 5000,
        amount_refunded: 2500,
        refunded: false,
        order_match: true,
      }),
    });
  });
});
