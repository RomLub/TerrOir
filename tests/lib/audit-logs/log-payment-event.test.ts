import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// `lib/audit-logs/log-payment-event.ts` importe 'server-only' (virtuel
// Next.js, non résolvable hors build webpack) → stub no-op.
vi.mock("server-only", () => ({}));

// Capture des inserts pour assertions. Pattern identique à
// log-auth-event.test.ts.
type InsertSpy = ((table: string, payload: unknown) => Promise<unknown>) & {
  mock: { calls: unknown[][] };
};
let insertSpy: InsertSpy;
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => ({
      insert: (payload: unknown) => insertSpy(table, payload),
    }),
  }),
}));

import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";

beforeEach(() => {
  insertSpy = vi.fn().mockResolvedValue({ error: null }) as unknown as InsertSpy;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logPaymentEvent — insert nominal", () => {
  it("insère un event order_payment_succeeded avec userId + metadata", async () => {
    await logPaymentEvent({
      eventType: "order_payment_succeeded",
      userId: "user-42",
      metadata: { order_id: "order-1", payment_intent_id: "pi_1" },
    });

    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(insertSpy).toHaveBeenCalledWith("audit_logs", {
      user_id: "user-42",
      event_type: "order_payment_succeeded",
      metadata: { order_id: "order-1", payment_intent_id: "pi_1" },
      ip_address: null,
      user_agent: null,
    });
  });

  it("insère un event order_payment_failed (instrumentation P2 rétroactive)", async () => {
    await logPaymentEvent({
      eventType: "order_payment_failed",
      userId: "user-7",
      metadata: { order_id: "order-2", payment_intent_id: "pi_2" },
    });

    expect(insertSpy).toHaveBeenCalledWith(
      "audit_logs",
      expect.objectContaining({ event_type: "order_payment_failed" }),
    );
  });

  it("insère un event order_revival_succeeded (path P1 résurrection)", async () => {
    await logPaymentEvent({
      eventType: "order_revival_succeeded",
      userId: "user-9",
      metadata: { order_id: "order-3", payment_intent_id: "pi_3" },
    });

    expect(insertSpy).toHaveBeenCalledWith(
      "audit_logs",
      expect.objectContaining({ event_type: "order_revival_succeeded" }),
    );
  });

  it("insère un event order_revival_blocked_stock avec metadata refund=ok", async () => {
    await logPaymentEvent({
      eventType: "order_revival_blocked_stock",
      userId: "user-12",
      metadata: { order_id: "order-4", payment_intent_id: "pi_4", refund: "ok" },
    });

    expect(insertSpy).toHaveBeenCalledWith(
      "audit_logs",
      expect.objectContaining({
        event_type: "order_revival_blocked_stock",
        metadata: expect.objectContaining({ refund: "ok" }),
      }),
    );
  });

  it("insère un event order_revival_blocked_slot", async () => {
    await logPaymentEvent({
      eventType: "order_revival_blocked_slot",
      userId: "user-13",
      metadata: { order_id: "order-5", payment_intent_id: "pi_5" },
    });

    expect(insertSpy).toHaveBeenCalledWith(
      "audit_logs",
      expect.objectContaining({ event_type: "order_revival_blocked_slot" }),
    );
  });

  it("insère un event order_revival_refund_failed avec error metadata pour retry admin", async () => {
    await logPaymentEvent({
      eventType: "order_revival_refund_failed",
      userId: "user-15",
      metadata: {
        order_id: "order-6",
        payment_intent_id: "pi_6",
        blocked_reason: "blocked_stock",
        refund_error: "Stripe API timeout",
      },
    });

    expect(insertSpy).toHaveBeenCalledWith(
      "audit_logs",
      expect.objectContaining({
        event_type: "order_revival_refund_failed",
        metadata: expect.objectContaining({
          refund_error: "Stripe API timeout",
          blocked_reason: "blocked_stock",
        }),
      }),
    );
  });

  it("insère un event order_admin_refund_failed (T-107 path admin manuel)", async () => {
    await logPaymentEvent({
      eventType: "order_admin_refund_failed",
      userId: "user-21",
      metadata: {
        order_id: "order-admin",
        payment_intent_id: "pi_admin",
        refund_error: "card_declined",
      },
    });

    expect(insertSpy).toHaveBeenCalledWith(
      "audit_logs",
      expect.objectContaining({
        event_type: "order_admin_refund_failed",
        metadata: expect.objectContaining({
          refund_error: "card_declined",
          payment_intent_id: "pi_admin",
        }),
      }),
    );
  });

  it("insère un event order_timeout_refund_failed (T-107 path cron timeout)", async () => {
    await logPaymentEvent({
      eventType: "order_timeout_refund_failed",
      userId: "user-22",
      metadata: {
        order_id: "order-timeout",
        payment_intent_id: "pi_timeout",
        refund_error: "Stripe network timeout",
      },
    });

    expect(insertSpy).toHaveBeenCalledWith(
      "audit_logs",
      expect.objectContaining({
        event_type: "order_timeout_refund_failed",
        metadata: expect.objectContaining({
          refund_error: "Stripe network timeout",
          payment_intent_id: "pi_timeout",
        }),
      }),
    );
  });
});

describe("logPaymentEvent — defaults", () => {
  it("userId omis → user_id = null (cas webhook orphelin sans fetch order)", async () => {
    await logPaymentEvent({
      eventType: "order_payment_failed",
      metadata: { order_id: "order-7" },
    });

    expect(insertSpy).toHaveBeenCalledWith(
      "audit_logs",
      expect.objectContaining({ user_id: null }),
    );
  });

  it("metadata omise → metadata = {}", async () => {
    await logPaymentEvent({
      eventType: "order_payment_succeeded",
      userId: "user-1",
    });

    expect(insertSpy).toHaveBeenCalledWith(
      "audit_logs",
      expect.objectContaining({ metadata: {} }),
    );
  });

  it("ip_address et user_agent toujours null (pas de fallback headers)", async () => {
    await logPaymentEvent({
      eventType: "order_payment_succeeded",
      userId: "user-1",
      metadata: { order_id: "order-8" },
    });

    expect(insertSpy).toHaveBeenCalledWith(
      "audit_logs",
      expect.objectContaining({ ip_address: null, user_agent: null }),
    );
  });
});

describe("logPaymentEvent — fail-safe", () => {
  it("ne re-throw pas si Supabase renvoie une error (table down, RLS denied)", async () => {
    insertSpy = vi
      .fn()
      .mockResolvedValue({ error: { message: "table not found" } }) as unknown as InsertSpy;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      logPaymentEvent({
        eventType: "order_payment_succeeded",
        userId: "user-1",
      }),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("AUDIT_LOG_INSERT_WARN"),
    );
  });

  it("ne re-throw pas si l'admin client throw (DB indispo, ECONNREFUSED)", async () => {
    insertSpy = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as InsertSpy;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      logPaymentEvent({
        eventType: "order_revival_refund_failed",
        userId: "user-9",
      }),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("AUDIT_LOG_WRITE_WARN"),
    );
  });
});
