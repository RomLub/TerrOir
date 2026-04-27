import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { syncStripePaymentSucceeded } from "@/lib/stripe/handle-payment-succeeded";
import { revalidatePublicStats } from "@/lib/stats/revalidate";

vi.mock("@/lib/stats/revalidate", () => ({
  revalidatePublicStats: vi.fn(),
}));

// Mock Supabase. Le helper effectue jusqu'à 2 chaînes :
//   1. from('orders').select('id, statut, cancellation_reason').eq('id', X).maybeSingle()
//        → fetchResp
//   2. from('orders').update({...}).eq('id', X)        (cas résurrection only)
//        → updateResp
type Resp = { data?: unknown; error?: unknown };

type Captured = {
  from: string[];
  update: unknown[];
  eq: Array<[string, unknown]>;
  select: string[];
  maybeSingle: number;
};

const DEFAULT_FETCH_PENDING: Resp = {
  data: { id: "order-42", statut: "pending", cancellation_reason: null },
  error: null,
};
const DEFAULT_UPDATE: Resp = { data: null, error: null };

function makeSupabase(opts: {
  fetchResp?: Resp;
  updateResp?: Resp;
} = {}): { client: SupabaseClient; captured: Captured } {
  const fetchResp = opts.fetchResp ?? DEFAULT_FETCH_PENDING;
  const updateResp = opts.updateResp ?? DEFAULT_UPDATE;

  const captured: Captured = {
    from: [],
    update: [],
    eq: [],
    select: [],
    maybeSingle: 0,
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

beforeEach(() => {
  consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(revalidatePublicStats).mockClear();
});

afterEach(() => {
  consoleLogSpy.mockRestore();
  consoleWarnSpy.mockRestore();
});

describe("syncStripePaymentSucceeded — Cas 1 : no_metadata", () => {
  it("PI sans metadata.order_id → no-op + return no_metadata", async () => {
    const { client, captured } = makeSupabase();
    const pi = makePaymentIntent({ id: "pi_setup", orderId: null });

    const res = await syncStripePaymentSucceeded(pi, client);

    expect(res).toEqual({ result: "no_metadata", orderId: null });
    expect(captured.from).toEqual([]);
    expect(captured.update).toEqual([]);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(vi.mocked(revalidatePublicStats)).not.toHaveBeenCalled();
  });
});

describe("syncStripePaymentSucceeded — Cas 2 : order_not_found", () => {
  it("order DB miss → log [WEBHOOK_SUCCEEDED_NO_ORDER] + return order_not_found", async () => {
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
    expect(vi.mocked(revalidatePublicStats)).not.toHaveBeenCalled();
  });
});

describe("syncStripePaymentSucceeded — Cas 3 : pending_to_notify (cas nominal)", () => {
  it("statut='pending' → pending_to_notify + revalidatePublicStats, pas d'UPDATE", async () => {
    const { client, captured } = makeSupabase();
    const pi = makePaymentIntent({ orderId: "order-42" });

    const res = await syncStripePaymentSucceeded(pi, client);

    expect(res).toEqual({ result: "pending_to_notify", orderId: "order-42" });
    expect(captured.from).toEqual(["orders"]); // SELECT only, pas d'UPDATE
    expect(captured.update).toEqual([]);
    expect(vi.mocked(revalidatePublicStats)).toHaveBeenCalledTimes(1);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });
});

describe("syncStripePaymentSucceeded — Cas 4 : already_confirmed (statut=confirmed)", () => {
  it("statut='confirmed' → already_confirmed (idempotent webhook rejoué après confirm manuel)", async () => {
    const { client, captured } = makeSupabase({
      fetchResp: {
        data: { id: "order-42", statut: "confirmed", cancellation_reason: null },
        error: null,
      },
    });
    const pi = makePaymentIntent({ orderId: "order-42" });

    const res = await syncStripePaymentSucceeded(pi, client);

    expect(res).toEqual({ result: "already_confirmed", orderId: "order-42" });
    expect(captured.update).toEqual([]);
    expect(vi.mocked(revalidatePublicStats)).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });
});

describe("syncStripePaymentSucceeded — Cas 5 : already_confirmed (statut=completed)", () => {
  it("statut='completed' → already_confirmed (cas progression rapide)", async () => {
    const { client, captured } = makeSupabase({
      fetchResp: {
        data: { id: "order-42", statut: "completed", cancellation_reason: null },
        error: null,
      },
    });
    const pi = makePaymentIntent({ orderId: "order-42" });

    const res = await syncStripePaymentSucceeded(pi, client);

    expect(res).toEqual({ result: "already_confirmed", orderId: "order-42" });
    expect(captured.update).toEqual([]);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });
});

describe("syncStripePaymentSucceeded — Cas 6 : revived_to_notify (résurrection 3DS-retry)", () => {
  it("cancelled+payment_failed → UPDATE statut=pending, reset reason+cancelled_at, revalidate, log [REVIVAL]", async () => {
    const { client, captured } = makeSupabase({
      fetchResp: {
        data: {
          id: "order-42",
          statut: "cancelled",
          cancellation_reason: "payment_failed",
        },
        error: null,
      },
    });
    const pi = makePaymentIntent({ id: "pi_retry", orderId: "order-42" });

    const res = await syncStripePaymentSucceeded(pi, client);

    expect(res).toEqual({ result: "revived_to_notify", orderId: "order-42" });

    // 1 SELECT + 1 UPDATE.
    expect(captured.from).toEqual(["orders", "orders"]);

    // Payload UPDATE : 3 champs reset à leurs valeurs canoniques pre-cancellation.
    expect(captured.update).toEqual([
      {
        statut: "pending",
        cancellation_reason: null,
        cancelled_at: null,
      },
    ]);

    // Filtres .eq sur les 2 chaînes.
    expect(captured.eq).toEqual([
      ["id", "order-42"],
      ["id", "order-42"],
    ]);

    // Cache public-stats invalidé (count public dépend du statut).
    expect(vi.mocked(revalidatePublicStats)).toHaveBeenCalledTimes(1);

    // Log REVIVAL grep-able pour Vercel.
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const logged = String(consoleLogSpy.mock.calls[0]?.[0]);
    expect(logged).toContain("[WEBHOOK_SUCCEEDED_REVIVAL]");
    expect(logged).toContain("order=order-42");
    expect(logged).toContain("pi=pi_retry");
    expect(logged).toContain("cancelled+payment_failed → pending");

    // Pas de warn (path "happy" résurrection).
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });
});

describe("syncStripePaymentSucceeded — Cas 7 : anomaly (cancelled non-payment_failed)", () => {
  it("cancelled+consumer_cancel → anomaly + log [WEBHOOK_SUCCEEDED_ANOMALY], pas d'UPDATE ni revalidate", async () => {
    const { client, captured } = makeSupabase({
      fetchResp: {
        data: {
          id: "order-42",
          statut: "cancelled",
          cancellation_reason: "consumer_cancel",
        },
        error: null,
      },
    });
    const pi = makePaymentIntent({ id: "pi_late", orderId: "order-42" });

    const res = await syncStripePaymentSucceeded(pi, client);

    expect(res).toEqual({ result: "anomaly", orderId: "order-42" });
    expect(captured.update).toEqual([]);
    expect(vi.mocked(revalidatePublicStats)).not.toHaveBeenCalled();

    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    const warned = String(consoleWarnSpy.mock.calls[0]?.[0]);
    expect(warned).toContain("[WEBHOOK_SUCCEEDED_ANOMALY]");
    expect(warned).toContain("order=order-42");
    expect(warned).toContain("statut=cancelled");
    expect(warned).toContain("reason=consumer_cancel");
  });
});

describe("syncStripePaymentSucceeded — Cas 8 : anomaly (refunded)", () => {
  it("refunded → anomaly + log warn", async () => {
    const { client, captured } = makeSupabase({
      fetchResp: {
        data: { id: "order-42", statut: "refunded", cancellation_reason: null },
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
