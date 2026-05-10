import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { syncStripePaymentFailed } from "@/lib/stripe/handle-payment-failed";
import { revalidatePublicStats } from "@/lib/stats/revalidate";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";

// Mock du wrapper server action — pas besoin d'invalider un vrai cache
// next/cache dans des tests vitest, on vérifie juste qu'il est appelé
// (resp. PAS appelé) selon le chemin pris.
vi.mock("@/lib/stats/revalidate", () => ({
  revalidatePublicStats: vi.fn(),
}));

// Mock audit log pour vérifier l'instrumentation Phase 2 (commit 2 chantier
// résurrection robuste). Le helper réel est testé séparément
// (tests/lib/audit-logs/log-payment-event.test.ts, commit 6b4a835).
vi.mock("@/lib/audit-logs/log-payment-event", () => ({
  logPaymentEvent: vi.fn(),
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
  rpcCalls: Array<{ name: string; params: unknown }>;
};

const DEFAULT_FETCH: Resp = {
  data: { id: "order-42", statut: "pending", consumer_id: "user-7" },
  error: null,
};
const DEFAULT_RPC_RESP: Resp = { data: null, error: null };

function makeSupabase(opts: {
  fetchResp?: Resp;
  // F-001 P0-TA : refetch post-RPC P0001 pour discriminer race vs anomalie.
  refetchResp?: Resp;
  // F-001 P0-TA : retour RPC cancel_order configurable (replace updateResp).
  rpcResp?: Resp;
  // Legacy (kept for backward compat with old tests calling updateResp).
  updateResp?: Resp;
} = {}): { client: SupabaseClient; captured: Captured } {
  const fetchResp = opts.fetchResp ?? DEFAULT_FETCH;
  const refetchResp = opts.refetchResp;
  const rpcResp = opts.rpcResp ?? opts.updateResp ?? DEFAULT_RPC_RESP;

  const captured: Captured = {
    from: [],
    update: [],
    eq: [],
    select: [],
    maybeSingle: 0,
    rpcCalls: [],
  };

  // F-001 P0-TA : la route appelle `from('orders').select(...).eq(id).maybeSingle()`
  // pour le lookup initial, puis `.rpc('cancel_order', ...)`. Sur P0001, elle
  // re-fetch via `from('orders').select('statut').eq(id).maybeSingle()` pour
  // discriminer race webhook vs vraie anomalie.
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
      // 1er appel from('orders') = lookup initial → fetchResp
      // 2e appel from('orders') = refetch post-RPC P0001 → refetchResp
      const resp = ordersCallCount === 1 ? fetchResp : refetchResp ?? fetchResp;
      return makeBuilder(() => resp);
    },
    rpc: (name: string, params: unknown) => {
      captured.rpcCalls.push({ name, params });
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

let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(revalidatePublicStats).mockClear();
  vi.mocked(logPaymentEvent).mockClear();
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

describe("syncStripePaymentFailed — Cas 6 : cancelled (cas nominal pending, F-001 P0-TA RPC)", () => {
  it("order pending → RPC cancel_order(payment_failed/cancelled) + revalidatePublicStats", async () => {
    const { client, captured } = makeSupabase();
    const pi = makePaymentIntent({ orderId: "order-42" });

    const res = await syncStripePaymentFailed(pi, client);

    expect(res).toEqual({ result: "cancelled", orderId: "order-42" });

    // F-001 P0-TA : 1 chaîne from('orders') pour le lookup initial,
    // puis .rpc('cancel_order') au lieu de from('orders').update().
    expect(captured.from).toEqual(["orders"]);
    expect(captured.update).toEqual([]);

    // RPC cancel_order avec params attendus.
    expect(captured.rpcCalls).toHaveLength(1);
    expect(captured.rpcCalls[0]).toEqual({
      name: "cancel_order",
      params: {
        p_order_id: "order-42",
        p_reason: "payment_failed",
        p_target_status: "cancelled",
      },
    });

    // Cache public-stats invalidé (count public dépend du statut).
    expect(vi.mocked(revalidatePublicStats)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(revalidatePublicStats)).toHaveBeenCalledWith({
      source: "stripe-payment-failed",
      orderId: "order-42",
    });
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  // F-001 P0-TA : variante fail-loud sur P0001 + refetch.
  it("RPC P0001 + refetch statut=cancelled (race) → already_terminal idempotent", async () => {
    const { client } = makeSupabase({
      rpcResp: {
        data: null,
        error: { code: "P0001", message: "illegal_transition" },
      },
      refetchResp: {
        data: { statut: "cancelled" },
        error: null,
      },
    });
    const pi = makePaymentIntent({ orderId: "order-race" });

    const res = await syncStripePaymentFailed(pi, client);

    expect(res).toEqual({ result: "already_terminal", orderId: "order-race" });
    expect(vi.mocked(revalidatePublicStats)).not.toHaveBeenCalled();
    expect(vi.mocked(logPaymentEvent)).not.toHaveBeenCalled();
  });

  it("RPC P0001 + refetch statut=pending (vraie anomalie) → rpc_error + log error", async () => {
    const { client } = makeSupabase({
      rpcResp: {
        data: null,
        error: { code: "P0001", message: "illegal_transition_unexpected" },
      },
      refetchResp: {
        data: { statut: "pending" },
        error: null,
      },
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const pi = makePaymentIntent({ orderId: "order-anomaly" });

    const res = await syncStripePaymentFailed(pi, client);

    expect(res).toEqual({ result: "rpc_error", orderId: "order-anomaly" });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(String(consoleErrorSpy.mock.calls[0]?.[0])).toContain(
      "[WEBHOOK_FAILED_RPC_UNEXPECTED]",
    );
    consoleErrorSpy.mockRestore();
  });
});

describe("syncStripePaymentFailed — Cas 7 : audit log Phase 2 (path nominal)", () => {
  it("path cancelled → log order_payment_failed avec userId=consumer_id + metadata", async () => {
    const { client } = makeSupabase();
    const pi = makePaymentIntent({ id: "pi_failed_audit", orderId: "order-42" });

    await syncStripePaymentFailed(pi, client);

    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith({
      eventType: "order_payment_failed",
      userId: "user-7", // consumer_id du DEFAULT_FETCH
      metadata: {
        order_id: "order-42",
        payment_intent_id: "pi_failed_audit",
      },
    });
  });

  it("consumer_id null sur l'order → audit log poussé avec userId=null (defensive)", async () => {
    const { client } = makeSupabase({
      fetchResp: {
        data: { id: "order-42", statut: "pending", consumer_id: null },
        error: null,
      },
    });
    const pi = makePaymentIntent({ orderId: "order-42" });

    await syncStripePaymentFailed(pi, client);

    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "order_payment_failed",
        userId: null,
      }),
    );
  });
});

describe("syncStripePaymentFailed — Cas 8 : pas d'audit log sur paths idempotents", () => {
  it("already_terminal (cancelled rejoué) → PAS d'audit log (évite duplication)", async () => {
    const { client } = makeSupabase({
      fetchResp: {
        data: { id: "order-42", statut: "cancelled", consumer_id: "user-7" },
        error: null,
      },
    });
    const pi = makePaymentIntent({ orderId: "order-42" });

    await syncStripePaymentFailed(pi, client);

    expect(vi.mocked(logPaymentEvent)).not.toHaveBeenCalled();
  });

  it("guard_confirmed (rétrogradation refusée) → PAS d'audit log (visible dans console.warn)", async () => {
    const { client } = makeSupabase({
      fetchResp: {
        data: { id: "order-42", statut: "confirmed", consumer_id: "user-7" },
        error: null,
      },
    });
    const pi = makePaymentIntent({ orderId: "order-42" });

    await syncStripePaymentFailed(pi, client);

    expect(vi.mocked(logPaymentEvent)).not.toHaveBeenCalled();
  });
});
