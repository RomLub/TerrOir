import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { retryFailedRefund } from "@/lib/stripe/retry-failed-refund";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";
import { stripe } from "@/lib/stripe/server";

vi.mock("@/lib/audit-logs/log-payment-event", () => ({
  logPaymentEvent: vi.fn(),
}));

vi.mock("@/lib/stripe/server", () => ({
  stripe: {
    refunds: {
      create: vi.fn(),
    },
  },
}));

// Mock Supabase admin : capture les opérations sur orders (UPDATE) et
// notifications (INSERT) pour assertions.
type Resp = { data?: unknown; error?: unknown };

type Captured = {
  fromTables: string[];
  updates: Array<{ table: string; payload: unknown }>;
  inserts: Array<{ table: string; payload: unknown }>;
  eqs: Array<[string, unknown]>;
};

function makeSupabase(opts: {
  orderUpdateResp?: Resp;
  notifInsertResp?: Resp;
} = {}): { client: SupabaseClient; captured: Captured } {
  const orderUpdateResp = opts.orderUpdateResp ?? { error: null };
  const notifInsertResp = opts.notifInsertResp ?? { error: null };

  const captured: Captured = {
    fromTables: [],
    updates: [],
    inserts: [],
    eqs: [],
  };

  const client = {
    from: (table: string) => {
      captured.fromTables.push(table);
      const builder: any = {};
      builder.update = (payload: unknown) => {
        captured.updates.push({ table, payload });
        return builder;
      };
      builder.insert = (payload: unknown) => {
        captured.inserts.push({ table, payload });
        return Promise.resolve(notifInsertResp);
      };
      builder.eq = (col: string, val: unknown) => {
        captured.eqs.push([col, val]);
        return Promise.resolve(orderUpdateResp);
      };
      return builder;
    },
  } as unknown as SupabaseClient;

  return { client, captured };
}

let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(logPaymentEvent).mockClear();
  vi.mocked(stripe.refunds.create).mockReset();
});

afterEach(() => {
  consoleLogSpy.mockRestore();
  consoleWarnSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

// ============================================================================
// Cas success : refund Stripe OK → UPDATE order + audit retried_succeeded.
// ============================================================================

describe("retryFailedRefund — succeeded path (attempt 1, blocked_stock)", () => {
  it("Stripe refund OK → UPDATE closure_reason + audit log + idempotencyKey passé", async () => {
    vi.mocked(stripe.refunds.create).mockResolvedValue({
      id: "re_retry_1",
    } as never);

    const { client, captured } = makeSupabase();

    const res = await retryFailedRefund({
      orderId: "order-42",
      paymentIntentId: "pi_blocked",
      kind: "revival",
      attempt: 1,
      blockedReason: "blocked_stock",
      consumerId: "user-7",
      admin: client,
    });

    expect(res).toBe("succeeded");

    // Idempotency key dérivée de (order_id, kind, attempt) — empêche double
    // refund + collision avec les autres paths refund (admin/timeout).
    expect(vi.mocked(stripe.refunds.create)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(stripe.refunds.create)).toHaveBeenCalledWith(
      { payment_intent: "pi_blocked" },
      { idempotencyKey: "refund_order-42_revival_1" },
    );

    // UPDATE order avec closure_reason mappée depuis blocked_stock.
    expect(captured.updates).toEqual([
      { table: "orders", payload: { closure_reason: "revival_blocked_stock" } },
    ]);
    expect(captured.eqs).toEqual([["id", "order-42"]]);

    // Audit log retried_succeeded avec metadata complète + kind.
    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith({
      eventType: "order_refund_retried_succeeded",
      userId: "user-7",
      metadata: {
        order_id: "order-42",
        payment_intent_id: "pi_blocked",
        kind: "revival",
        attempt: 1,
        refund_id: "re_retry_1",
        blocked_reason: "blocked_stock",
      },
    });

    // Pas d'insertion notif (pas exhausted).
    expect(captured.inserts).toEqual([]);

    // Log success grep-able.
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    expect(String(consoleLogSpy.mock.calls[0]?.[0])).toContain(
      "[REFUND_RETRY_SUCCESS]",
    );
  });
});

describe("retryFailedRefund — succeeded path (attempt 2, blocked_slot)", () => {
  it("blocked_slot → closure_reason='revival_blocked_slot' + idempotencyKey attempt 2", async () => {
    vi.mocked(stripe.refunds.create).mockResolvedValue({
      id: "re_retry_2",
    } as never);

    const { client, captured } = makeSupabase();

    const res = await retryFailedRefund({
      orderId: "order-99",
      paymentIntentId: "pi_slot",
      kind: "revival",
      attempt: 2,
      blockedReason: "blocked_slot",
      consumerId: "user-12",
      admin: client,
    });

    expect(res).toBe("succeeded");
    expect(vi.mocked(stripe.refunds.create)).toHaveBeenCalledWith(
      { payment_intent: "pi_slot" },
      { idempotencyKey: "refund_order-99_revival_2" },
    );
    expect(captured.updates).toEqual([
      { table: "orders", payload: { closure_reason: "revival_blocked_slot" } },
    ]);
    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "order_refund_retried_succeeded",
        metadata: expect.objectContaining({
          kind: "revival",
          attempt: 2,
          blocked_reason: "blocked_slot",
        }),
      }),
    );
  });
});

describe("retryFailedRefund — succeeded with DB drift (UPDATE fails)", () => {
  it("Stripe OK + UPDATE order fails → audit log quand même + log [REFUND_RETRY_DB_DRIFT]", async () => {
    vi.mocked(stripe.refunds.create).mockResolvedValue({
      id: "re_drift",
    } as never);

    const { client } = makeSupabase({
      orderUpdateResp: { error: { message: "connection lost" } },
    });

    const res = await retryFailedRefund({
      orderId: "order-drift",
      paymentIntentId: "pi_drift",
      kind: "revival",
      attempt: 1,
      blockedReason: "blocked_stock",
      consumerId: "user-7",
      admin: client,
    });

    // Refund succès même si UPDATE rate (refund Stripe est la source of truth,
    // l'UPDATE est juste pour drill-down UI).
    expect(res).toBe("succeeded");

    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(String(consoleWarnSpy.mock.calls[0]?.[0])).toContain(
      "[REFUND_RETRY_DB_DRIFT]",
    );

    // Audit log quand même posé (single source of truth pour le retry cron).
    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "order_refund_retried_succeeded",
      }),
    );
  });
});

// ============================================================================
// Cas failed_will_retry : refund échoue, attempt < 3 → re-pose refund_failed.
// ============================================================================

describe("retryFailedRefund — failed_will_retry (attempt 1)", () => {
  it("Stripe throw + attempt=1 → audit refund_failed re-posté + return failed_will_retry", async () => {
    vi.mocked(stripe.refunds.create).mockRejectedValue(
      new Error("Stripe network error"),
    );

    const { client, captured } = makeSupabase();

    const res = await retryFailedRefund({
      orderId: "order-fail",
      paymentIntentId: "pi_fail",
      kind: "revival",
      attempt: 1,
      blockedReason: "blocked_stock",
      consumerId: "user-7",
      admin: client,
    });

    expect(res).toBe("failed_will_retry");

    // Pas d'UPDATE order (état préservé en cas d'échec).
    expect(captured.updates).toEqual([]);
    // Pas de notif (pas exhausted).
    expect(captured.inserts).toEqual([]);

    // Audit log refund_failed avec metadata attempt + retry_error + kind.
    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith({
      eventType: "order_revival_refund_failed",
      userId: "user-7",
      metadata: {
        order_id: "order-fail",
        payment_intent_id: "pi_fail",
        kind: "revival",
        attempt: 1,
        retry_error: "Stripe network error",
        blocked_reason: "blocked_stock",
      },
    });

    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(String(consoleWarnSpy.mock.calls[0]?.[0])).toContain(
      "[REFUND_RETRY_FAILED]",
    );
  });
});

describe("retryFailedRefund — failed_will_retry (attempt 2)", () => {
  it("Stripe throw + attempt=2 → audit refund_failed avec attempt=2, pas exhausted", async () => {
    vi.mocked(stripe.refunds.create).mockRejectedValue(
      new Error("rate limit"),
    );

    const { client, captured } = makeSupabase();

    const res = await retryFailedRefund({
      orderId: "order-fail-2",
      paymentIntentId: "pi_fail_2",
      kind: "revival",
      attempt: 2,
      blockedReason: "blocked_slot",
      consumerId: null,
      admin: client,
    });

    expect(res).toBe("failed_will_retry");

    // Un seul audit log (pas exhausted), userId=null toléré.
    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "order_revival_refund_failed",
        userId: null,
        metadata: expect.objectContaining({
          attempt: 2,
          retry_error: "rate limit",
        }),
      }),
    );
    expect(captured.inserts).toEqual([]);
  });
});

// ============================================================================
// Cas failed_exhausted : refund échoue à attempt=3 → 2 audit logs + notif.
// ============================================================================

describe("retryFailedRefund — failed_exhausted (attempt 3)", () => {
  it("Stripe throw + attempt=3 → 2 audit logs (failed + exhausted) + notification admin insérée", async () => {
    vi.mocked(stripe.refunds.create).mockRejectedValue(
      new Error("Stripe API down"),
    );

    const { client, captured } = makeSupabase();

    const res = await retryFailedRefund({
      orderId: "order-exhausted",
      paymentIntentId: "pi_exhausted",
      kind: "revival",
      attempt: 3,
      blockedReason: "blocked_stock",
      consumerId: "user-7",
      admin: client,
    });

    expect(res).toBe("failed_exhausted");

    // 2 audit logs : refund_failed (incrémente compteur) + retry_exhausted
    // (sortie de boucle pour le cron). Tous deux portent metadata.kind.
    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledTimes(2);

    expect(vi.mocked(logPaymentEvent)).toHaveBeenNthCalledWith(1, {
      eventType: "order_revival_refund_failed",
      userId: "user-7",
      metadata: {
        order_id: "order-exhausted",
        payment_intent_id: "pi_exhausted",
        kind: "revival",
        attempt: 3,
        retry_error: "Stripe API down",
        blocked_reason: "blocked_stock",
      },
    });

    expect(vi.mocked(logPaymentEvent)).toHaveBeenNthCalledWith(2, {
      eventType: "order_refund_retry_exhausted",
      userId: "user-7",
      metadata: {
        order_id: "order-exhausted",
        payment_intent_id: "pi_exhausted",
        kind: "revival",
        attempts_total: 3,
        last_error: "Stripe API down",
        blocked_reason: "blocked_stock",
      },
    });

    // Notification admin insérée avec template='refund_retry_exhausted'.
    expect(captured.inserts).toEqual([
      {
        table: "notifications",
        payload: {
          user_id: null,
          type: "email",
          template: "refund_retry_exhausted",
          statut: "failed",
          metadata: {
            order_id: "order-exhausted",
            payment_intent_id: "pi_exhausted",
            kind: "revival",
            attempts_total: 3,
            last_error: "Stripe API down",
            blocked_reason: "blocked_stock",
          },
        },
      },
    ]);

    // Pas d'UPDATE order (état préservé).
    expect(captured.updates).toEqual([]);

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(String(consoleErrorSpy.mock.calls[0]?.[0])).toContain(
      "[REFUND_RETRY_EXHAUSTED]",
    );
  });
});

describe("retryFailedRefund — failed_exhausted with notif insert error", () => {
  it("notification insert fail → swallow + log [REFUND_RETRY_NOTIF_WARN], audit logs préservés", async () => {
    vi.mocked(stripe.refunds.create).mockRejectedValue(new Error("boom"));

    const { client } = makeSupabase({
      notifInsertResp: { error: { message: "RLS denied" } },
    });

    const res = await retryFailedRefund({
      orderId: "order-notif-fail",
      paymentIntentId: "pi_x",
      kind: "revival",
      attempt: 3,
      blockedReason: "blocked_slot",
      consumerId: "user-9",
      admin: client,
    });

    expect(res).toBe("failed_exhausted");

    // 2 audit logs préservés malgré notif échouée.
    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledTimes(2);

    // Log warn pour la notif + log error exhausted = 1 chacun.
    const notifWarnCall = consoleWarnSpy.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes("[REFUND_RETRY_NOTIF_WARN]"),
    );
    expect(notifWarnCall).toBeDefined();
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// T-412 : kind='admin' (path /api/stripe/refund) — pas de blockedReason,
// closure_reason='admin_refund', event_type failed='order_admin_refund_failed'.
// ============================================================================

describe("retryFailedRefund — kind='admin' (T-412)", () => {
  it("succeeded → idempotencyKey kind=admin + closure_reason='admin_refund' + audit kind=admin", async () => {
    vi.mocked(stripe.refunds.create).mockResolvedValue({
      id: "re_admin",
    } as never);

    const { client, captured } = makeSupabase();

    const res = await retryFailedRefund({
      orderId: "order-admin-1",
      paymentIntentId: "pi_admin_1",
      kind: "admin",
      attempt: 1,
      consumerId: "user-7",
      admin: client,
    });

    expect(res).toBe("succeeded");
    expect(vi.mocked(stripe.refunds.create)).toHaveBeenCalledWith(
      { payment_intent: "pi_admin_1" },
      { idempotencyKey: "refund_order-admin-1_admin_1" },
    );
    expect(captured.updates).toEqual([
      { table: "orders", payload: { closure_reason: "admin_refund" } },
    ]);
    // Audit log retried_succeeded sans blocked_reason (admin path).
    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith({
      eventType: "order_refund_retried_succeeded",
      userId: "user-7",
      metadata: {
        order_id: "order-admin-1",
        payment_intent_id: "pi_admin_1",
        kind: "admin",
        attempt: 1,
        refund_id: "re_admin",
      },
    });
  });

  it("failed_will_retry → audit event_type='order_admin_refund_failed' + metadata.kind='admin'", async () => {
    vi.mocked(stripe.refunds.create).mockRejectedValue(
      new Error("admin retry fail"),
    );

    const { client } = makeSupabase();

    const res = await retryFailedRefund({
      orderId: "order-admin-2",
      paymentIntentId: "pi_admin_2",
      kind: "admin",
      attempt: 2,
      consumerId: "user-7",
      admin: client,
    });

    expect(res).toBe("failed_will_retry");
    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith({
      eventType: "order_admin_refund_failed",
      userId: "user-7",
      metadata: {
        order_id: "order-admin-2",
        payment_intent_id: "pi_admin_2",
        kind: "admin",
        attempt: 2,
        retry_error: "admin retry fail",
      },
    });
  });
});

// ============================================================================
// T-412 : kind='timeout' (path cron order-timeout) — pas de blockedReason,
// closure_reason='timeout', event_type failed='order_timeout_refund_failed'.
// ============================================================================

describe("retryFailedRefund — kind='timeout' (T-412)", () => {
  it("succeeded → idempotencyKey kind=timeout + closure_reason='timeout' + audit kind=timeout", async () => {
    vi.mocked(stripe.refunds.create).mockResolvedValue({
      id: "re_timeout",
    } as never);

    const { client, captured } = makeSupabase();

    const res = await retryFailedRefund({
      orderId: "order-timeout-1",
      paymentIntentId: "pi_timeout_1",
      kind: "timeout",
      attempt: 1,
      consumerId: "user-7",
      admin: client,
    });

    expect(res).toBe("succeeded");
    expect(vi.mocked(stripe.refunds.create)).toHaveBeenCalledWith(
      { payment_intent: "pi_timeout_1" },
      { idempotencyKey: "refund_order-timeout-1_timeout_1" },
    );
    expect(captured.updates).toEqual([
      { table: "orders", payload: { closure_reason: "timeout" } },
    ]);
  });

  it("failed_exhausted → 2 audit logs avec metadata.kind='timeout' + notif metadata.kind", async () => {
    vi.mocked(stripe.refunds.create).mockRejectedValue(new Error("timeout boom"));

    const { client, captured } = makeSupabase();

    const res = await retryFailedRefund({
      orderId: "order-timeout-3",
      paymentIntentId: "pi_timeout_3",
      kind: "timeout",
      attempt: 3,
      consumerId: "user-7",
      admin: client,
    });

    expect(res).toBe("failed_exhausted");

    // 1er log : refund_failed timeout-specific
    expect(vi.mocked(logPaymentEvent)).toHaveBeenNthCalledWith(1, {
      eventType: "order_timeout_refund_failed",
      userId: "user-7",
      metadata: {
        order_id: "order-timeout-3",
        payment_intent_id: "pi_timeout_3",
        kind: "timeout",
        attempt: 3,
        retry_error: "timeout boom",
      },
    });
    // 2e log : exhausted générique avec kind
    expect(vi.mocked(logPaymentEvent)).toHaveBeenNthCalledWith(2, {
      eventType: "order_refund_retry_exhausted",
      userId: "user-7",
      metadata: expect.objectContaining({
        kind: "timeout",
        attempts_total: 3,
      }),
    });

    // Notif metadata porte aussi le kind.
    expect(captured.inserts[0]?.payload).toMatchObject({
      template: "refund_retry_exhausted",
      metadata: expect.objectContaining({ kind: "timeout" }),
    });
  });
});
