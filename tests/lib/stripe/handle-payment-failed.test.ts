import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { syncStripePaymentFailed } from "@/lib/stripe/handle-payment-failed";
import { revalidatePublicStats } from "@/lib/stats/revalidate";

// Mock du wrapper server action — pas besoin d'invalider un vrai cache
// next/cache dans des tests vitest, on vérifie juste qu'il est appelé
// (resp. PAS appelé) selon le chemin pris.
vi.mock("@/lib/stats/revalidate", () => ({
  revalidatePublicStats: vi.fn(),
}));

// Mock Supabase. Le helper effectue jusqu'à 2 chaînes :
//   1. from('orders').select('id, statut').eq('id', X).maybeSingle()
//        → fetchResp
//   2. from('orders').update({...}).eq('id', X)
//        → updateResp (nominal uniquement)
type Resp = { data?: unknown; error?: unknown };

type Captured = {
  from: string[];
  update: unknown[];
  eq: Array<[string, unknown]>;
  select: string[];
  maybeSingle: number;
};

const DEFAULT_FETCH: Resp = {
  data: { id: "order-42", statut: "pending" },
  error: null,
};
const DEFAULT_UPDATE: Resp = { data: null, error: null };

function makeSupabase(opts: {
  fetchResp?: Resp;
  updateResp?: Resp;
} = {}): { client: SupabaseClient; captured: Captured } {
  const fetchResp = opts.fetchResp ?? DEFAULT_FETCH;
  const updateResp = opts.updateResp ?? DEFAULT_UPDATE;

  const captured: Captured = {
    from: [],
    update: [],
    eq: [],
    select: [],
    maybeSingle: 0,
  };

  // Le helper appelle from('orders') 1 ou 2 fois (fetch puis update).
  // Premier appel = fetch (chaîne avec maybeSingle), deuxième = update
  // (chaîne thenable sans maybeSingle).
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

let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(revalidatePublicStats).mockClear();
});

afterEach(() => {
  consoleWarnSpy.mockRestore();
});

describe("syncStripePaymentFailed — Cas 1 : no_metadata", () => {
  it("PI sans metadata.order_id → no-op + return no_metadata", async () => {
    const { client, captured } = makeSupabase();
    const pi = makePaymentIntent({ id: "pi_setup", orderId: null });

    const res = await syncStripePaymentFailed(pi, client);

    expect(res).toEqual({ result: "no_metadata", orderId: null });
    expect(captured.from).toEqual([]);
    expect(captured.update).toEqual([]);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(vi.mocked(revalidatePublicStats)).not.toHaveBeenCalled();
  });
});

describe("syncStripePaymentFailed — Cas 2 : order_not_found", () => {
  it("order DB miss → log [WEBHOOK_FAILED_NO_ORDER] + return order_not_found", async () => {
    const { client, captured } = makeSupabase({
      fetchResp: { data: null, error: null },
    });
    const pi = makePaymentIntent({ id: "pi_orphan", orderId: "order-ghost" });

    const res = await syncStripePaymentFailed(pi, client);

    expect(res).toEqual({ result: "order_not_found", orderId: "order-ghost" });
    expect(captured.from).toEqual(["orders"]);
    expect(captured.update).toEqual([]);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(String(consoleWarnSpy.mock.calls[0]?.[0])).toContain(
      "[WEBHOOK_FAILED_NO_ORDER]",
    );
    expect(vi.mocked(revalidatePublicStats)).not.toHaveBeenCalled();
  });
});

describe("syncStripePaymentFailed — Cas 3 : already_terminal (cancelled)", () => {
  it("order déjà cancelled (webhook rejoué) → no-op idempotent", async () => {
    const { client, captured } = makeSupabase({
      fetchResp: { data: { id: "order-42", statut: "cancelled" }, error: null },
    });
    const pi = makePaymentIntent({ orderId: "order-42" });

    const res = await syncStripePaymentFailed(pi, client);

    expect(res).toEqual({ result: "already_terminal", orderId: "order-42" });
    expect(captured.update).toEqual([]);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(vi.mocked(revalidatePublicStats)).not.toHaveBeenCalled();
  });
});

describe("syncStripePaymentFailed — Cas 4 : already_terminal (completed)", () => {
  it("order déjà completed (litige post-retrait) → no-op", async () => {
    const { client, captured } = makeSupabase({
      fetchResp: { data: { id: "order-42", statut: "completed" }, error: null },
    });
    const pi = makePaymentIntent({ orderId: "order-42" });

    const res = await syncStripePaymentFailed(pi, client);

    expect(res).toEqual({ result: "already_terminal", orderId: "order-42" });
    expect(captured.update).toEqual([]);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });
});

describe("syncStripePaymentFailed — Cas 5 : guard_confirmed (statut=confirmed)", () => {
  it("order confirmed (succeeded déjà encaissé) → guard + log [WEBHOOK_FAILED_AFTER_SUCCEEDED_NOOP]", async () => {
    const { client, captured } = makeSupabase({
      fetchResp: { data: { id: "order-42", statut: "confirmed" }, error: null },
    });
    const pi = makePaymentIntent({ id: "pi_late_fail", orderId: "order-42" });

    const res = await syncStripePaymentFailed(pi, client);

    expect(res).toEqual({ result: "guard_confirmed", orderId: "order-42" });
    expect(captured.update).toEqual([]);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    const logged = String(consoleWarnSpy.mock.calls[0]?.[0]);
    expect(logged).toContain("[WEBHOOK_FAILED_AFTER_SUCCEEDED_NOOP]");
    expect(logged).toContain("order=order-42");
    expect(logged).toContain("status=confirmed");
    expect(vi.mocked(revalidatePublicStats)).not.toHaveBeenCalled();
  });
});

describe("syncStripePaymentFailed — Cas 6 : guard_confirmed (statut=ready)", () => {
  it("order ready → même protection que confirmed", async () => {
    const { client } = makeSupabase({
      fetchResp: { data: { id: "order-42", statut: "ready" }, error: null },
    });
    const pi = makePaymentIntent({ orderId: "order-42" });

    const res = await syncStripePaymentFailed(pi, client);

    expect(res).toEqual({ result: "guard_confirmed", orderId: "order-42" });
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(String(consoleWarnSpy.mock.calls[0]?.[0])).toContain(
      "status=ready",
    );
  });
});

describe("syncStripePaymentFailed — Cas 7 : cancelled (cas nominal pending)", () => {
  it("order pending → UPDATE avec cancellation_reason='payment_failed' + revalidatePublicStats", async () => {
    const { client, captured } = makeSupabase();
    const pi = makePaymentIntent({ orderId: "order-42" });

    const res = await syncStripePaymentFailed(pi, client);

    expect(res).toEqual({ result: "cancelled", orderId: "order-42" });

    // Doit avoir émis 2 chaînes from('orders') : fetch + update.
    expect(captured.from).toEqual(["orders", "orders"]);

    // Le payload UPDATE contient bien les 3 champs attendus.
    expect(captured.update).toHaveLength(1);
    const payload = captured.update[0] as Record<string, unknown>;
    expect(payload.statut).toBe("cancelled");
    expect(payload.cancellation_reason).toBe("payment_failed");
    expect(payload.cancelled_at).toEqual(expect.any(String));
    expect(() => new Date(payload.cancelled_at as string)).not.toThrow();

    // Le filtre WHERE est bien posé sur l'order_id (1 fetch + 1 update).
    expect(captured.eq).toEqual([
      ["id", "order-42"],
      ["id", "order-42"],
    ]);

    // Cache public-stats invalidé (count public dépend du statut).
    expect(vi.mocked(revalidatePublicStats)).toHaveBeenCalledTimes(1);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });
});
