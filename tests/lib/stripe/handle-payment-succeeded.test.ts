import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { syncStripePaymentSucceeded } from "@/lib/stripe/handle-payment-succeeded";
import { revalidatePublicStats } from "@/lib/stats/revalidate";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";
import { stripe } from "@/lib/stripe/server";

vi.mock("@/lib/stats/revalidate", () => ({
  revalidatePublicStats: vi.fn(),
}));

// Mock audit log (chantier résurrection robuste). Helper réel testé
// séparément (tests/lib/audit-logs/log-payment-event.test.ts).
vi.mock("@/lib/audit-logs/log-payment-event", () => ({
  logPaymentEvent: vi.fn(),
}));

// Mock Stripe SDK : seul `stripe.refunds.create` est appelé par la fonction.
// Re-mocké par scénario via vi.mocked(stripe.refunds.create).mockResolved/Rejected.
vi.mock("@/lib/stripe/server", () => ({
  stripe: {
    refunds: {
      create: vi.fn(),
    },
  },
}));

// Mock Supabase. Le helper effectue jusqu'à 3 chaînes selon le path :
//   1. from('orders').select('id, statut, closure_reason, consumer_id').eq.maybeSingle()
//        → fetchResp
//   2. (résurrection) admin.rpc('revive_order_with_stock_check', ...)
//        → rpcResp
//   3. (blocked + refund OK) from('orders').update({...}).eq()
//        → updateResp
type Resp = { data?: unknown; error?: unknown };

type Captured = {
  from: string[];
  update: unknown[];
  eq: Array<[string, unknown]>;
  select: string[];
  maybeSingle: number;
  rpcCalls: Array<{ fn: string; params: unknown }>;
};

const DEFAULT_FETCH_PENDING: Resp = {
  data: {
    id: "order-42",
    statut: "pending",
    closure_reason: null,
    consumer_id: "user-7",
  },
  error: null,
};
const DEFAULT_UPDATE: Resp = { data: null, error: null };

function makeSupabase(opts: {
  fetchResp?: Resp;
  updateResp?: Resp;
  rpcResp?: Resp;
} = {}): { client: SupabaseClient; captured: Captured } {
  const fetchResp = opts.fetchResp ?? DEFAULT_FETCH_PENDING;
  const updateResp = opts.updateResp ?? DEFAULT_UPDATE;
  const rpcResp = opts.rpcResp ?? { data: null, error: null };

  const captured: Captured = {
    from: [],
    update: [],
    eq: [],
    select: [],
    maybeSingle: 0,
    rpcCalls: [],
  };

  let ordersCallCount = 0;

  function makeBuilder(getResp: () => Resp) {
    const builder: any = {};
    builder.update = (payload: unknown) => {
      captured.update.push(payload);
      return builder;
    };
    builder.eq = (col: string, val: unknown) => {
      captured.eq.push([col, val]);
      return builder;
    };
    builder.select = (cols: string) => {
      captured.select.push(cols);
      return builder;
    };
    builder.maybeSingle = () => {
      captured.maybeSingle += 1;
      return Promise.resolve(getResp());
    };
    builder.then = (onFulfilled: (r: Resp) => unknown) =>
      onFulfilled(getResp());
    return builder;
  }

  const client = {
    from: (table: string) => {
      captured.from.push(table);
      ordersCallCount += 1;
      const isFirst = ordersCallCount === 1;
      return makeBuilder(() => (isFirst ? fetchResp : updateResp));
    },
    rpc: (fn: string, params: unknown) => {
      captured.rpcCalls.push({ fn, params });
      return Promise.resolve(rpcResp);
    },
  } as unknown as SupabaseClient;

  return { client, captured };
}

function makePaymentIntent(opts: {
  id?: string;
  orderId?: string | null;
}): Stripe.PaymentIntent {
  const metadata: Record<string, string> = {};
  if (opts.orderId) metadata.order_id = opts.orderId;
  return {
    id: opts.id ?? "pi_test",
    metadata,
  } as unknown as Stripe.PaymentIntent;
}

let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(revalidatePublicStats).mockClear();
  vi.mocked(logPaymentEvent).mockClear();
  vi.mocked(stripe.refunds.create).mockReset();
});

afterEach(() => {
  consoleLogSpy.mockRestore();
  consoleWarnSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

// =============================================================================
// Cas 1-8 : paths existants (P1 commit 49c0f1b), mis à jour pour vérifier
// l'instrumentation audit log Phase 2.
// =============================================================================

describe("syncStripePaymentSucceeded — Cas 1 : no_metadata", () => {
  it("PI sans metadata.order_id → no-op + return no_metadata", async () => {
    const { client, captured } = makeSupabase();
    const pi = makePaymentIntent({ id: "pi_setup", orderId: null });

    const res = await syncStripePaymentSucceeded(pi, client);

    expect(res).toEqual({ result: "no_metadata", orderId: null });
    expect(captured.from).toEqual([]);
    expect(captured.rpcCalls).toEqual([]);
    expect(captured.update).toEqual([]);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(vi.mocked(revalidatePublicStats)).not.toHaveBeenCalled();
    expect(vi.mocked(logPaymentEvent)).not.toHaveBeenCalled();
  });
});

describe("syncStripePaymentSucceeded — Cas 2 : order_not_found", () => {
  it("order DB miss → log [WEBHOOK_SUCCEEDED_NO_ORDER] + return order_not_found, pas d'audit", async () => {
    const { client, captured } = makeSupabase({
      fetchResp: { data: null, error: null },
    });
    const pi = makePaymentIntent({ id: "pi_orphan", orderId: "order-ghost" });

    const res = await syncStripePaymentSucceeded(pi, client);

    expect(res).toEqual({ result: "order_not_found", orderId: "order-ghost" });
    expect(captured.from).toEqual(["orders"]);
    expect(captured.update).toEqual([]);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(String(consoleWarnSpy.mock.calls[0]?.[0])).toContain(
      "[WEBHOOK_SUCCEEDED_NO_ORDER]",
    );
    expect(vi.mocked(logPaymentEvent)).not.toHaveBeenCalled();
  });
});

describe("syncStripePaymentSucceeded — Cas 3 : pending_to_notify (cas nominal)", () => {
  it("statut='pending' → revalidate + audit log order_payment_succeeded + return enum", async () => {
    const { client, captured } = makeSupabase();
    const pi = makePaymentIntent({ id: "pi_succ", orderId: "order-42" });

    const res = await syncStripePaymentSucceeded(pi, client);

    expect(res).toEqual({ result: "pending_to_notify", orderId: "order-42" });
    expect(captured.from).toEqual(["orders"]); // SELECT only, pas d'UPDATE
    expect(captured.update).toEqual([]);
    expect(captured.rpcCalls).toEqual([]); // pas de résurrection
    // T-100 C2 : signature enrichie {source, orderId, extra.step='nominal'}.
    expect(vi.mocked(revalidatePublicStats)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(revalidatePublicStats)).toHaveBeenCalledWith({
      source: "stripe-payment-succeeded",
      orderId: "order-42",
      extra: { step: "nominal" },
    });

    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith({
      eventType: "order_payment_succeeded",
      userId: "user-7",
      metadata: { order_id: "order-42", payment_intent_id: "pi_succ" },
    });
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });
});

describe("syncStripePaymentSucceeded — Cas 4 : already_confirmed (statut=confirmed)", () => {
  it("statut='confirmed' → already_confirmed (idempotent), pas d'audit log dupliqué", async () => {
    const { client, captured } = makeSupabase({
      fetchResp: {
        data: {
          id: "order-42",
          statut: "confirmed",
          closure_reason: null,
          consumer_id: "user-7",
        },
        error: null,
      },
    });
    const pi = makePaymentIntent({ orderId: "order-42" });

    const res = await syncStripePaymentSucceeded(pi, client);

    expect(res).toEqual({ result: "already_confirmed", orderId: "order-42" });
    expect(captured.update).toEqual([]);
    expect(captured.rpcCalls).toEqual([]);
    expect(vi.mocked(revalidatePublicStats)).not.toHaveBeenCalled();
    expect(vi.mocked(logPaymentEvent)).not.toHaveBeenCalled();
  });
});

describe("syncStripePaymentSucceeded — Cas 5 : already_confirmed (statut=completed)", () => {
  it("statut='completed' → already_confirmed (cas progression rapide)", async () => {
    const { client, captured } = makeSupabase({
      fetchResp: {
        data: {
          id: "order-42",
          statut: "completed",
          closure_reason: null,
          consumer_id: "user-7",
        },
        error: null,
      },
    });
    const pi = makePaymentIntent({ orderId: "order-42" });

    const res = await syncStripePaymentSucceeded(pi, client);

    expect(res).toEqual({ result: "already_confirmed", orderId: "order-42" });
    expect(captured.update).toEqual([]);
    expect(vi.mocked(logPaymentEvent)).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Cas 6+ : paths résurrection avec RPC + refund (chantier résurrection robuste).
// =============================================================================

describe("syncStripePaymentSucceeded — Cas 6 : revived_to_notify (RPC=revived)", () => {
  it("cancelled+payment_failed + RPC retourne 'revived' → audit log + revalidate + return enum", async () => {
    const { client, captured } = makeSupabase({
      fetchResp: {
        data: {
          id: "order-42",
          statut: "cancelled",
          closure_reason: "payment_failed",
          consumer_id: "user-7",
        },
        error: null,
      },
      rpcResp: { data: "revived", error: null },
    });
    const pi = makePaymentIntent({ id: "pi_retry", orderId: "order-42" });

    const res = await syncStripePaymentSucceeded(pi, client);

    expect(res).toEqual({ result: "revived_to_notify", orderId: "order-42" });

    // RPC appelée avec le bon nom + params.
    expect(captured.rpcCalls).toEqual([
      { fn: "revive_order_with_stock_check", params: { p_order_id: "order-42" } },
    ]);

    // PAS d'UPDATE direct côté JS : la RPC s'en charge atomiquement.
    expect(captured.update).toEqual([]);

    // Cache public-stats invalidé.
    // T-100 C2 : signature enrichie {source, orderId, extra.step='revived'}.
    expect(vi.mocked(revalidatePublicStats)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(revalidatePublicStats)).toHaveBeenCalledWith({
      source: "stripe-payment-succeeded",
      orderId: "order-42",
      extra: { step: "revived" },
    });

    // Audit log Phase 2.
    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith({
      eventType: "order_revival_succeeded",
      userId: "user-7",
      metadata: { order_id: "order-42", payment_intent_id: "pi_retry" },
    });

    // Log REVIVAL grep-able.
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    expect(String(consoleLogSpy.mock.calls[0]?.[0])).toContain(
      "[WEBHOOK_SUCCEEDED_REVIVAL]",
    );
  });
});

describe("syncStripePaymentSucceeded — Cas 7 : revival_blocked_stock + refund OK", () => {
  it("RPC blocked_stock + Stripe refund OK → UPDATE closure_reason + audit log + log warn", async () => {
    vi.mocked(stripe.refunds.create).mockResolvedValue({
      id: "re_123",
    } as never);

    const { client, captured } = makeSupabase({
      fetchResp: {
        data: {
          id: "order-42",
          statut: "cancelled",
          closure_reason: "payment_failed",
          consumer_id: "user-7",
        },
        error: null,
      },
      rpcResp: { data: "blocked_stock", error: null },
    });
    const pi = makePaymentIntent({ id: "pi_blocked_s", orderId: "order-42" });

    const res = await syncStripePaymentSucceeded(pi, client);

    expect(res).toEqual({
      result: "revival_blocked_stock",
      orderId: "order-42",
    });

    // Refund Stripe appelé avec le bon PI.
    expect(vi.mocked(stripe.refunds.create)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(stripe.refunds.create)).toHaveBeenCalledWith({
      payment_intent: "pi_blocked_s",
    });

    // UPDATE closure_reason='revival_blocked_stock' (statut reste
    // cancelled, cancelled_at reste figé).
    expect(captured.update).toEqual([
      { closure_reason: "revival_blocked_stock" },
    ]);

    // Audit log avec metadata refund='ok'.
    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith({
      eventType: "order_revival_blocked_stock",
      userId: "user-7",
      metadata: {
        order_id: "order-42",
        payment_intent_id: "pi_blocked_s",
        refund: "ok",
      },
    });

    // Log warn grep-able.
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(String(consoleWarnSpy.mock.calls[0]?.[0])).toContain(
      "[WEBHOOK_SUCCEEDED_REVIVAL_BLOCKED]",
    );
  });
});

describe("syncStripePaymentSucceeded — Cas 8 : revival_blocked_slot + refund OK", () => {
  it("RPC blocked_slot + Stripe refund OK → closure_reason='revival_blocked_slot' + audit", async () => {
    vi.mocked(stripe.refunds.create).mockResolvedValue({ id: "re_456" } as never);

    const { client, captured } = makeSupabase({
      fetchResp: {
        data: {
          id: "order-42",
          statut: "cancelled",
          closure_reason: "payment_failed",
          consumer_id: "user-7",
        },
        error: null,
      },
      rpcResp: { data: "blocked_slot", error: null },
    });
    const pi = makePaymentIntent({ id: "pi_blocked_t", orderId: "order-42" });

    const res = await syncStripePaymentSucceeded(pi, client);

    expect(res).toEqual({
      result: "revival_blocked_slot",
      orderId: "order-42",
    });
    expect(captured.update).toEqual([
      { closure_reason: "revival_blocked_slot" },
    ]);
    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith({
      eventType: "order_revival_blocked_slot",
      userId: "user-7",
      metadata: {
        order_id: "order-42",
        payment_intent_id: "pi_blocked_t",
        refund: "ok",
      },
    });
  });
});

describe("syncStripePaymentSucceeded — Cas 9 : revival_refund_failed (stock blocked, Stripe throw)", () => {
  it("RPC blocked_stock + Stripe refund throw → audit log refund_failed + NO UPDATE order", async () => {
    vi.mocked(stripe.refunds.create).mockRejectedValue(
      new Error("Stripe API timeout"),
    );

    const { client, captured } = makeSupabase({
      fetchResp: {
        data: {
          id: "order-42",
          statut: "cancelled",
          closure_reason: "payment_failed",
          consumer_id: "user-7",
        },
        error: null,
      },
      rpcResp: { data: "blocked_stock", error: null },
    });
    const pi = makePaymentIntent({ id: "pi_refund_fail", orderId: "order-42" });

    const res = await syncStripePaymentSucceeded(pi, client);

    expect(res).toEqual({
      result: "revival_refund_failed",
      orderId: "order-42",
    });

    // Refund tenté (et a throw).
    expect(vi.mocked(stripe.refunds.create)).toHaveBeenCalledTimes(1);

    // ⚠️ Critique : NE PAS UPDATE l'order. État cancelled+payment_failed
    // préservé pour permettre retry admin manuel.
    expect(captured.update).toEqual([]);

    // Audit log avec metadata error pour traçabilité.
    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith({
      eventType: "order_revival_refund_failed",
      userId: "user-7",
      metadata: {
        order_id: "order-42",
        payment_intent_id: "pi_refund_fail",
        blocked_reason: "blocked_stock",
        refund_error: "Stripe API timeout",
      },
    });

    // Log error grep-able [REFUND_FAILED] côté Vercel.
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(String(consoleErrorSpy.mock.calls[0]?.[0])).toContain(
      "[WEBHOOK_SUCCEEDED_REFUND_FAILED]",
    );
  });
});

describe("syncStripePaymentSucceeded — Cas 10 : revival_refund_failed (slot blocked, Stripe throw)", () => {
  it("RPC blocked_slot + Stripe refund throw → audit log avec blocked_reason='blocked_slot'", async () => {
    vi.mocked(stripe.refunds.create).mockRejectedValue(
      new Error("Idempotency key conflict"),
    );

    const { client, captured } = makeSupabase({
      fetchResp: {
        data: {
          id: "order-42",
          statut: "cancelled",
          closure_reason: "payment_failed",
          consumer_id: "user-7",
        },
        error: null,
      },
      rpcResp: { data: "blocked_slot", error: null },
    });
    const pi = makePaymentIntent({ orderId: "order-42" });

    const res = await syncStripePaymentSucceeded(pi, client);

    expect(res.result).toBe("revival_refund_failed");
    expect(captured.update).toEqual([]);

    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "order_revival_refund_failed",
        metadata: expect.objectContaining({
          blocked_reason: "blocked_slot",
          refund_error: "Idempotency key conflict",
        }),
      }),
    );
  });
});

describe("syncStripePaymentSucceeded — Cas 11 : RPC retourne error (PostgREST)", () => {
  it("RPC error → log [RPC_ERR] + return anomaly, pas de refund, pas d'audit", async () => {
    const { client, captured } = makeSupabase({
      fetchResp: {
        data: {
          id: "order-42",
          statut: "cancelled",
          closure_reason: "payment_failed",
          consumer_id: "user-7",
        },
        error: null,
      },
      rpcResp: { data: null, error: { message: "function does not exist" } },
    });
    const pi = makePaymentIntent({ orderId: "order-42" });

    const res = await syncStripePaymentSucceeded(pi, client);

    expect(res).toEqual({ result: "anomaly", orderId: "order-42" });
    expect(vi.mocked(stripe.refunds.create)).not.toHaveBeenCalled();
    expect(captured.update).toEqual([]);
    expect(vi.mocked(logPaymentEvent)).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(String(consoleWarnSpy.mock.calls[0]?.[0])).toContain(
      "[WEBHOOK_SUCCEEDED_RPC_ERR]",
    );
  });
});

describe("syncStripePaymentSucceeded — Cas 12 : RPC retourne valeur inattendue", () => {
  it("RPC retourne 'unknown_value' → log [RPC_UNKNOWN] + return anomaly", async () => {
    const { client } = makeSupabase({
      fetchResp: {
        data: {
          id: "order-42",
          statut: "cancelled",
          closure_reason: "payment_failed",
          consumer_id: "user-7",
        },
        error: null,
      },
      rpcResp: { data: "something_else", error: null },
    });
    const pi = makePaymentIntent({ orderId: "order-42" });

    const res = await syncStripePaymentSucceeded(pi, client);

    expect(res).toEqual({ result: "anomaly", orderId: "order-42" });
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(String(consoleWarnSpy.mock.calls[0]?.[0])).toContain(
      "[WEBHOOK_SUCCEEDED_RPC_UNKNOWN]",
    );
  });
});

// =============================================================================
// Cas 13-14 : anomaly (cancelled non-payment_failed et refunded), inchangés
// par le chantier résurrection robuste.
// =============================================================================

describe("syncStripePaymentSucceeded — Cas 13 : anomaly (cancelled+consumer_cancel)", () => {
  it("cancelled avec autre reason → anomaly + log warn, pas d'audit log", async () => {
    const { client, captured } = makeSupabase({
      fetchResp: {
        data: {
          id: "order-42",
          statut: "cancelled",
          closure_reason: "consumer_cancel",
          consumer_id: "user-7",
        },
        error: null,
      },
    });
    const pi = makePaymentIntent({ id: "pi_late", orderId: "order-42" });

    const res = await syncStripePaymentSucceeded(pi, client);

    expect(res).toEqual({ result: "anomaly", orderId: "order-42" });
    expect(captured.update).toEqual([]);
    expect(captured.rpcCalls).toEqual([]); // pas d'appel RPC pour ce cas
    expect(vi.mocked(logPaymentEvent)).not.toHaveBeenCalled();

    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    const warned = String(consoleWarnSpy.mock.calls[0]?.[0]);
    expect(warned).toContain("[WEBHOOK_SUCCEEDED_ANOMALY]");
    expect(warned).toContain("reason=consumer_cancel");
  });
});

describe("syncStripePaymentSucceeded — Cas 14 : anomaly (refunded)", () => {
  it("refunded → anomaly + log warn", async () => {
    const { client, captured } = makeSupabase({
      fetchResp: {
        data: {
          id: "order-42",
          statut: "refunded",
          closure_reason: null,
          consumer_id: "user-7",
        },
        error: null,
      },
    });
    const pi = makePaymentIntent({ orderId: "order-42" });

    const res = await syncStripePaymentSucceeded(pi, client);

    expect(res).toEqual({ result: "anomaly", orderId: "order-42" });
    expect(captured.update).toEqual([]);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(String(consoleWarnSpy.mock.calls[0]?.[0])).toContain(
      "statut=refunded",
    );
  });
});
