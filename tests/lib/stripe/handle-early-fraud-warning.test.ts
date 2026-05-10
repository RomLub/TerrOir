import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import type { ChainableMockBuilder } from "./_mock-builder";

vi.hoisted(() => {
  process.env.SUPPORT_EMAIL = process.env.SUPPORT_EMAIL ?? "admin@terroir-local.fr";
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
});

vi.mock("@/lib/audit-logs/log-payment-event", () => ({
  logPaymentEvent: vi.fn(),
}));
vi.mock("@/lib/refund-incidents/record-refund-attempt", () => ({
  recordRefundAttempt: vi.fn(),
}));
vi.mock("@/lib/refund-incidents/classify-error", () => ({
  classifyRefundError: vi.fn(() => ({
    category: "permanent",
    code: "charge_already_refunded",
    type: "invalid_request_error",
    message: "mocked",
    statusCode: 400,
    requestId: null,
    declineCode: null,
  })),
}));
vi.mock("@/lib/resend/send", () => ({
  sendTemplate: vi.fn().mockResolvedValue({ ok: true, id: "resend_id" }),
}));
const { mockWaitUntil } = vi.hoisted(() => ({ mockWaitUntil: vi.fn() }));
vi.mock("@vercel/functions", () => ({ waitUntil: mockWaitUntil }));
vi.mock("@/lib/resend/templates/admin-early-fraud-warning", () => ({
  default: () => null,
  subject: () => "Subject mock",
}));
vi.mock("@/lib/stripe/server", () => ({
  stripe: {
    refunds: {
      create: vi.fn(),
    },
    charges: {
      retrieve: vi.fn(),
    },
  },
}));

import { syncStripeEarlyFraudWarning } from "@/lib/stripe/handle-early-fraud-warning";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";
import { sendTemplate } from "@/lib/resend/send";
import { stripe } from "@/lib/stripe/server";
import { recordRefundAttempt } from "@/lib/refund-incidents/record-refund-attempt";

type Resp = { data?: unknown; error?: unknown };

interface Fixture {
  orderResp?: Resp;
  updateResp?: Resp;
}

type Captured = {
  from: string[];
  update: unknown[];
  eq: Array<[string, unknown]>;
  rpcCalls: Array<{ name: string; params: unknown }>;
};

function makeSupabase(fixture: Fixture = {}): {
  client: SupabaseClient;
  captured: Captured;
} {
  const captured: Captured = { from: [], update: [], eq: [], rpcCalls: [] };

  function ordersBuilder() {
    const b: ChainableMockBuilder = {};
    let isUpdate = false;
    b.select = () => b;
    b.update = (payload: unknown) => {
      isUpdate = true;
      captured.update.push(payload);
      return b;
    };
    b.eq = (col: string, val: unknown) => {
      captured.eq.push([col, val]);
      return b;
    };
    b.maybeSingle = () =>
      Promise.resolve(fixture.orderResp ?? { data: null, error: null });
    b.then = (onFulfilled: (r: Resp) => unknown) => {
      if (isUpdate) {
        return onFulfilled(fixture.updateResp ?? { data: null, error: null });
      }
      return onFulfilled({ data: null, error: null });
    };
    return b;
  }

  const client = {
    from: (table: string) => {
      captured.from.push(table);
      if (table === "orders") return ordersBuilder();
      throw new Error(`unexpected from(${table})`);
    },
    // F-001 P0-TA : RPC cancel_order remplace l'UPDATE direct côté caller
    // EFW. fixture.updateResp réutilisé pour préserver les tests qui
    // injectaient des erreurs via cette key (mapping rpcResp).
    rpc: (name: string, params: unknown) => {
      captured.rpcCalls.push({ name, params });
      return Promise.resolve(fixture.updateResp ?? { data: null, error: null });
    },
  } as unknown as SupabaseClient;

  return { client, captured };
}

function makeEfw(
  overrides: Partial<Stripe.Radar.EarlyFraudWarning> = {},
): Stripe.Radar.EarlyFraudWarning {
  return {
    id: "issfr_test_1",
    object: "radar.early_fraud_warning",
    actionable: true,
    charge: "ch_test_1",
    created: 1700000000,
    fraud_type: "fraudulent_card_application",
    livemode: false,
    payment_intent: "pi_test_1",
    ...overrides,
  } as unknown as Stripe.Radar.EarlyFraudWarning;
}

const ORDER_FIXTURE = {
  data: {
    id: "order-42",
    statut: "confirmed",
    code_commande: "TER-2026-0042",
    consumer_id: "user-7",
    montant_total: 25.5,
  },
  error: null,
};

beforeEach(() => {
  vi.mocked(logPaymentEvent).mockReset().mockResolvedValue(undefined);
  vi.mocked(sendTemplate).mockReset().mockResolvedValue({ ok: true, id: "resend_id" });
  vi.mocked(recordRefundAttempt).mockReset().mockResolvedValue(null);
  vi.mocked(stripe.refunds.create).mockReset();
  vi.mocked(stripe.charges.retrieve).mockReset();
  mockWaitUntil.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("syncStripeEarlyFraudWarning — path nominal (refunded)", () => {
  it("EFW reçu, order existe et statut=confirmed → refund + update + audit + email admin", async () => {
    const { client, captured } = makeSupabase({ orderResp: ORDER_FIXTURE });
    vi.mocked(stripe.refunds.create).mockResolvedValue({
      id: "re_efw_1",
    } as never);

    const out = await syncStripeEarlyFraudWarning(makeEfw(), client);

    expect(out.result).toBe("refunded");
    expect(out.orderId).toBe("order-42");

    expect(vi.mocked(stripe.refunds.create)).toHaveBeenCalledWith(
      { payment_intent: "pi_test_1" },
      { idempotencyKey: "refund_order-42_efw" },
    );

    // F-001 P0-TA : transition refunded via RPC SECDEF cancel_order
    // (reason='efw_preemptive' ∈ skip-list audit RPC, audit Stripe-aware
    // côté caller posé via logPaymentEvent ci-dessous).
    expect(captured.rpcCalls).toContainEqual({
      name: "cancel_order",
      params: {
        p_order_id: "order-42",
        p_reason: "efw_preemptive",
        p_target_status: "refunded",
      },
    });
    expect(captured.update).toEqual([]);

    // Audit log avec metadata enrichie.
    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith({
      eventType: "stripe_early_fraud_warning_received",
      userId: "user-7",
      metadata: expect.objectContaining({
        efw_id: "issfr_test_1",
        order_id: "order-42",
        order_match: true,
        refund_action: "succeeded",
        refund_id: "re_efw_1",
        fraud_type: "fraudulent_card_application",
      }),
    });

    // Email admin envoyé via waitUntil(sendTemplate).
    expect(mockWaitUntil).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendTemplate)).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "admin@terroir-local.fr",
        template: "admin_early_fraud_warning",
      }),
    );
  });
});

describe("syncStripeEarlyFraudWarning — no_order_match (PI orphelin)", () => {
  it("EFW reçu sur PI introuvable en DB → log warning + audit log order_match=false + pas de refund", async () => {
    const { client, captured } = makeSupabase({ orderResp: { data: null, error: null } });

    const out = await syncStripeEarlyFraudWarning(makeEfw(), client);

    expect(out.result).toBe("no_order_match");
    expect(out.orderId).toBeNull();
    expect(vi.mocked(stripe.refunds.create)).not.toHaveBeenCalled();
    expect(captured.update.length).toBe(0);

    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith({
      eventType: "stripe_early_fraud_warning_received",
      metadata: expect.objectContaining({
        efw_id: "issfr_test_1",
        order_match: false,
      }),
    });
    expect(mockWaitUntil).not.toHaveBeenCalled();
  });
});

describe("syncStripeEarlyFraudWarning — order déjà refundée (idempotent)", () => {
  it("EFW reçu sur order statut=refunded → audit log seul (skipped_already_refunded), pas de 2e refund", async () => {
    const { client } = makeSupabase({
      orderResp: {
        data: { ...ORDER_FIXTURE.data, statut: "refunded" },
        error: null,
      },
    });

    const out = await syncStripeEarlyFraudWarning(makeEfw(), client);

    expect(out.result).toBe("already_refunded");
    expect(out.orderId).toBe("order-42");
    expect(vi.mocked(stripe.refunds.create)).not.toHaveBeenCalled();

    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith({
      eventType: "stripe_early_fraud_warning_received",
      userId: "user-7",
      metadata: expect.objectContaining({
        order_id: "order-42",
        order_match: true,
        refund_action: "skipped_already_refunded",
      }),
    });
    expect(mockWaitUntil).not.toHaveBeenCalled();
  });
});

describe("syncStripeEarlyFraudWarning — refund Stripe throw", () => {
  it("Refund Stripe throw → audit log error + classified + record_refund_attempt + return refund_failed", async () => {
    const { client } = makeSupabase({ orderResp: ORDER_FIXTURE });
    vi.mocked(stripe.refunds.create).mockRejectedValue(
      new Error("network_error"),
    );

    const out = await syncStripeEarlyFraudWarning(makeEfw(), client);

    expect(out.result).toBe("refund_failed");
    expect(out.orderId).toBe("order-42");

    expect(vi.mocked(recordRefundAttempt)).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order-42",
        kind: "admin",
        outcome: "failed",
      }),
    );
    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith({
      eventType: "stripe_early_fraud_warning_received",
      userId: "user-7",
      metadata: expect.objectContaining({
        order_id: "order-42",
        order_match: true,
        refund_action: "failed",
        refund_error_category: "permanent",
      }),
    });
    expect(mockWaitUntil).not.toHaveBeenCalled();
  });
});

describe("syncStripeEarlyFraudWarning — fallback charge.retrieve quand PI manquant sur EFW", () => {
  it("EFW sans payment_intent direct → retrieve charge.payment_intent + lookup order", async () => {
    const { client } = makeSupabase({ orderResp: ORDER_FIXTURE });
    vi.mocked(stripe.charges.retrieve).mockResolvedValue({
      id: "ch_test_1",
      payment_intent: "pi_test_1",
    } as never);
    vi.mocked(stripe.refunds.create).mockResolvedValue({
      id: "re_efw_2",
    } as never);

    const efwSansPi = makeEfw({ payment_intent: undefined });
    const out = await syncStripeEarlyFraudWarning(efwSansPi, client);

    expect(out.result).toBe("refunded");
    expect(vi.mocked(stripe.charges.retrieve)).toHaveBeenCalledWith("ch_test_1");
    expect(vi.mocked(stripe.refunds.create)).toHaveBeenCalledWith(
      { payment_intent: "pi_test_1" },
      { idempotencyKey: "refund_order-42_efw" },
    );
  });
});
