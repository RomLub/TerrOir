import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

// Mock Stripe SDK : seul stripe.refunds.create est appelé par le helper.
vi.mock("@/lib/stripe/server", () => ({
  stripe: {
    refunds: { create: vi.fn() },
  },
}));

// Mock recordRefundAttempt : helper testé séparément
// (tests/lib/refund-incidents/record-refund-attempt.test.ts).
vi.mock("@/lib/refund-incidents/record-refund-attempt", () => ({
  recordRefundAttempt: vi.fn(),
}));

// Mock classifyRefundError : pure function testée séparément
// (tests/lib/refund-incidents/classify-error.test.ts). Mocker permet de
// piloter la category attendue par chaque test sans construire de fausses
// instances Stripe.errors.*.
vi.mock("@/lib/refund-incidents/classify-error", () => ({
  classifyRefundError: vi.fn(),
}));

import { retryIncident } from "@/lib/refund-incidents/retry-incident";
import { stripe } from "@/lib/stripe/server";
import { recordRefundAttempt } from "@/lib/refund-incidents/record-refund-attempt";
import { classifyRefundError } from "@/lib/refund-incidents/classify-error";
import type { SupabaseClient } from "@supabase/supabase-js";

// Mock Supabase admin client. retryIncident utilise admin pour :
//   - admin.from("orders").update({...}).eq("id", orderId) (kind=revival success)
//   - admin.from("notifications").insert({...}) (exhausted)
type Captured = {
  fromCalls: string[];
  ordersUpdate: unknown[];
  notificationsInsert: unknown[];
};

let captured: Captured;
let ordersUpdateError: { message: string } | null;
let ordersUpdateThrow: Error | null;
let notificationsInsertError: { message: string } | null;

function makeAdmin(): SupabaseClient {
  return {
    from: (table: string) => {
      captured.fromCalls.push(table);
      if (table === "orders") {
        return {
          update: (payload: unknown) => {
            captured.ordersUpdate.push(payload);
            return {
              eq: (_col: string, _val: unknown) => {
                if (ordersUpdateThrow) throw ordersUpdateThrow;
                return Promise.resolve({ error: ordersUpdateError });
              },
            };
          },
        };
      }
      if (table === "notifications") {
        return {
          insert: (payload: unknown) => {
            captured.notificationsInsert.push(payload);
            return Promise.resolve({ error: notificationsInsertError });
          },
        };
      }
      throw new Error(`unexpected from(${table})`);
    },
  } as unknown as SupabaseClient;
}

let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  captured = {
    fromCalls: [],
    ordersUpdate: [],
    notificationsInsert: [],
  };
  ordersUpdateError = null;
  ordersUpdateThrow = null;
  notificationsInsertError = null;
  vi.mocked(stripe.refunds.create).mockReset();
  vi.mocked(recordRefundAttempt).mockReset();
  (classifyRefundError as Mock).mockReset();
  consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleLogSpy.mockRestore();
  consoleWarnSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

const baseParams = {
  incidentId: "inc-1",
  orderId: "order-1",
  paymentIntentId: "pi_1",
  consumerId: "user-7" as string | null,
  retryCount: 0,
};

// =============================================================================
// A. Succès Stripe
// =============================================================================

describe("retryIncident — succès Stripe", () => {
  it("kind='admin' OK → 'succeeded' + recordRefundAttempt(succeeded) + PAS d'UPDATE closure_reason", async () => {
    vi.mocked(stripe.refunds.create).mockResolvedValue({
      id: "re_admin_ok",
    } as never);
    vi.mocked(recordRefundAttempt).mockResolvedValue({
      incidentId: "inc-1",
      incidentStatus: "succeeded",
      attemptId: "att-1",
      attemptNumber: 1,
    });

    const res = await retryIncident({
      ...baseParams,
      kind: "admin",
      blockedReason: null,
      admin: makeAdmin(),
    });

    expect(res).toBe("succeeded");
    // idempotencyKey calculé sur attempt_number = retryCount + 1 = 1
    expect(stripe.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_1" },
      { idempotencyKey: "refund_order-1_admin_1" },
    );
    expect(recordRefundAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "succeeded",
        kind: "admin",
        stripeRefundId: "re_admin_ok",
        classified: null,
      }),
    );
    // Aucun UPDATE orders pour kind=admin (closure_reason déjà posée au 1er coup).
    expect(captured.ordersUpdate).toEqual([]);
    expect(captured.fromCalls).toEqual([]);
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    expect(String(consoleLogSpy.mock.calls[0]?.[0])).toContain(
      "[REFUND_RETRY_SUCCESS]",
    );
  });

  it("kind='timeout' OK → 'succeeded' + PAS d'UPDATE closure_reason", async () => {
    vi.mocked(stripe.refunds.create).mockResolvedValue({
      id: "re_to",
    } as never);
    vi.mocked(recordRefundAttempt).mockResolvedValue({
      incidentId: "inc-1",
      incidentStatus: "succeeded",
      attemptId: "att-1",
      attemptNumber: 2,
    });

    const res = await retryIncident({
      ...baseParams,
      kind: "timeout",
      blockedReason: null,
      retryCount: 1,
      admin: makeAdmin(),
    });

    expect(res).toBe("succeeded");
    expect(stripe.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_1" },
      { idempotencyKey: "refund_order-1_timeout_2" },
    );
    expect(captured.ordersUpdate).toEqual([]);
  });

  it("kind='revival' blocked_stock OK → 'succeeded' + UPDATE closure_reason='revival_blocked_stock'", async () => {
    vi.mocked(stripe.refunds.create).mockResolvedValue({
      id: "re_rev_stock",
    } as never);
    vi.mocked(recordRefundAttempt).mockResolvedValue({
      incidentId: "inc-1",
      incidentStatus: "succeeded",
      attemptId: "att-1",
      attemptNumber: 1,
    });

    const res = await retryIncident({
      ...baseParams,
      kind: "revival",
      blockedReason: "blocked_stock",
      admin: makeAdmin(),
    });

    expect(res).toBe("succeeded");
    expect(captured.fromCalls).toEqual(["orders"]);
    expect(captured.ordersUpdate).toEqual([
      { closure_reason: "revival_blocked_stock" },
    ]);
  });

  it("kind='revival' blocked_slot OK → 'succeeded' + UPDATE closure_reason='revival_blocked_slot'", async () => {
    vi.mocked(stripe.refunds.create).mockResolvedValue({
      id: "re_rev_slot",
    } as never);
    vi.mocked(recordRefundAttempt).mockResolvedValue({
      incidentId: "inc-1",
      incidentStatus: "succeeded",
      attemptId: "att-1",
      attemptNumber: 1,
    });

    const res = await retryIncident({
      ...baseParams,
      kind: "revival",
      blockedReason: "blocked_slot",
      admin: makeAdmin(),
    });

    expect(res).toBe("succeeded");
    expect(captured.ordersUpdate).toEqual([
      { closure_reason: "revival_blocked_slot" },
    ]);
  });

  it("R3 — kind='revival' OK + UPDATE rate (PostgREST error) → 'succeeded' quand même + warn [REFUND_RETRY_DB_DRIFT]", async () => {
    vi.mocked(stripe.refunds.create).mockResolvedValue({
      id: "re_rev_drift",
    } as never);
    vi.mocked(recordRefundAttempt).mockResolvedValue({
      incidentId: "inc-1",
      incidentStatus: "succeeded",
      attemptId: "att-1",
      attemptNumber: 1,
    });
    ordersUpdateError = { message: "RLS denied" };

    const res = await retryIncident({
      ...baseParams,
      kind: "revival",
      blockedReason: "blocked_stock",
      admin: makeAdmin(),
    });

    // ⚠️ R3 critique : on retourne 'succeeded' quand même (Stripe a refundé,
    // pas de re-throw qui re-tenterait le refund au prochain run).
    expect(res).toBe("succeeded");
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(String(consoleWarnSpy.mock.calls[0]?.[0])).toContain(
      "[REFUND_RETRY_DB_DRIFT]",
    );
    expect(String(consoleWarnSpy.mock.calls[0]?.[0])).toContain("RLS denied");
  });

  it("R3 — kind='revival' OK + UPDATE throw exception → 'succeeded' quand même + warn [REFUND_RETRY_DB_DRIFT]", async () => {
    vi.mocked(stripe.refunds.create).mockResolvedValue({
      id: "re_rev_exc",
    } as never);
    vi.mocked(recordRefundAttempt).mockResolvedValue({
      incidentId: "inc-1",
      incidentStatus: "succeeded",
      attemptId: "att-1",
      attemptNumber: 1,
    });
    ordersUpdateThrow = new Error("network down");

    const res = await retryIncident({
      ...baseParams,
      kind: "revival",
      blockedReason: "blocked_slot",
      admin: makeAdmin(),
    });

    expect(res).toBe("succeeded");
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(String(consoleWarnSpy.mock.calls[0]?.[0])).toContain(
      "[REFUND_RETRY_DB_DRIFT]",
    );
    expect(String(consoleWarnSpy.mock.calls[0]?.[0])).toContain("network down");
  });
});

// =============================================================================
// B. Échec Stripe — safe_to_retry / unknown (will_retry)
// =============================================================================

describe("retryIncident — échec Stripe will_retry (status pas exhausted)", () => {
  it("safe_to_retry, RPC retourne status='retrying' → 'failed_will_retry'", async () => {
    vi.mocked(stripe.refunds.create).mockRejectedValue(
      new Error("rate limit"),
    );
    (classifyRefundError as Mock).mockReturnValue({
      category: "safe_to_retry",
      code: "rate_limit",
      type: "rate_limit_error",
      message: "rate limit",
      statusCode: 429,
      requestId: "req_rl",
      declineCode: null,
    });
    vi.mocked(recordRefundAttempt).mockResolvedValue({
      incidentId: "inc-1",
      incidentStatus: "retrying",
      attemptId: "att-2",
      attemptNumber: 2,
    });

    const res = await retryIncident({
      ...baseParams,
      kind: "admin",
      blockedReason: null,
      retryCount: 1,
      admin: makeAdmin(),
    });

    expect(res).toBe("failed_will_retry");
    expect(recordRefundAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "failed",
        kind: "admin",
        classified: expect.objectContaining({ category: "safe_to_retry" }),
      }),
    );
    // Pas de notification placeholder (pas exhausted).
    expect(captured.notificationsInsert).toEqual([]);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(String(consoleWarnSpy.mock.calls[0]?.[0])).toContain(
      "[REFUND_RETRY_FAILED]",
    );
  });

  it("unknown, RPC retourne status='pending' (1er échec, n'est pas encore retrying) → 'failed_will_retry'", async () => {
    vi.mocked(stripe.refunds.create).mockRejectedValue(
      new Error("processing error"),
    );
    (classifyRefundError as Mock).mockReturnValue({
      category: "unknown",
      code: "processing_error",
      type: "invalid_request_error",
      message: "processing error",
      statusCode: 400,
      requestId: "req_proc",
      declineCode: null,
    });
    vi.mocked(recordRefundAttempt).mockResolvedValue({
      incidentId: "inc-1",
      incidentStatus: "pending",
      attemptId: "att-1",
      attemptNumber: 1,
    });

    const res = await retryIncident({
      ...baseParams,
      kind: "timeout",
      blockedReason: null,
      admin: makeAdmin(),
    });

    expect(res).toBe("failed_will_retry");
    expect(captured.notificationsInsert).toEqual([]);
  });
});

// =============================================================================
// C. Échec Stripe — exhausted (max_retries atteint)
// =============================================================================

describe("retryIncident — échec Stripe exhausted (max_retries atteint)", () => {
  it("safe_to_retry, 3e échec, status devient 'exhausted' → 'failed_exhausted' + INSERT notification", async () => {
    vi.mocked(stripe.refunds.create).mockRejectedValue(
      new Error("rate limit again"),
    );
    (classifyRefundError as Mock).mockReturnValue({
      category: "safe_to_retry",
      code: "rate_limit",
      type: "rate_limit_error",
      message: "rate limit again",
      statusCode: 429,
      requestId: "req_rl3",
      declineCode: null,
    });
    vi.mocked(recordRefundAttempt).mockResolvedValue({
      incidentId: "inc-1",
      incidentStatus: "exhausted",
      attemptId: "att-3",
      attemptNumber: 3,
    });

    const res = await retryIncident({
      ...baseParams,
      kind: "revival",
      blockedReason: "blocked_stock",
      retryCount: 2,
      admin: makeAdmin(),
    });

    expect(res).toBe("failed_exhausted");
    // INSERT notification placeholder (template + statut + metadata enrichie).
    expect(captured.fromCalls).toEqual(["notifications"]);
    expect(captured.notificationsInsert).toHaveLength(1);
    const notif = captured.notificationsInsert[0] as Record<string, unknown>;
    expect(notif.user_id).toBeNull();
    expect(notif.type).toBe("email");
    expect(notif.template).toBe("refund_retry_exhausted");
    expect(notif.statut).toBe("failed");
    const meta = notif.metadata as Record<string, unknown>;
    expect(meta.incident_id).toBe("inc-1");
    expect(meta.order_id).toBe("order-1");
    expect(meta.kind).toBe("revival");
    expect(meta.attempt).toBe(3);
    expect(meta.short_circuit).toBe(false);
    expect(meta.stripe_error_code).toBe("rate_limit");
    // Log error grep-able.
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(String(consoleErrorSpy.mock.calls[0]?.[0])).toContain(
      "[REFUND_RETRY_EXHAUSTED]",
    );
  });

  it("INSERT notification rate (RLS denied) → 'failed_exhausted' quand même + warn [REFUND_RETRY_NOTIF_WARN]", async () => {
    vi.mocked(stripe.refunds.create).mockRejectedValue(
      new Error("api_error"),
    );
    (classifyRefundError as Mock).mockReturnValue({
      category: "safe_to_retry",
      code: null,
      type: "api_error",
      message: "api_error",
      statusCode: 500,
      requestId: "req_5xx",
      declineCode: null,
    });
    vi.mocked(recordRefundAttempt).mockResolvedValue({
      incidentId: "inc-1",
      incidentStatus: "exhausted",
      attemptId: "att-3",
      attemptNumber: 3,
    });
    notificationsInsertError = { message: "RLS denied on notifications" };

    const res = await retryIncident({
      ...baseParams,
      kind: "admin",
      blockedReason: null,
      retryCount: 2,
      admin: makeAdmin(),
    });

    expect(res).toBe("failed_exhausted");
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(String(consoleWarnSpy.mock.calls[0]?.[0])).toContain(
      "[REFUND_RETRY_NOTIF_WARN]",
    );
  });
});

// =============================================================================
// D. Court-circuit permanent
// =============================================================================

describe("retryIncident — court-circuit permanent (Q4 T-102.2.b)", () => {
  it("permanent au 1er retry → 'failed_permanent_short_circuit' + INSERT notif avec short_circuit=true", async () => {
    vi.mocked(stripe.refunds.create).mockRejectedValue(
      new Error("Already refunded"),
    );
    (classifyRefundError as Mock).mockReturnValue({
      category: "permanent",
      code: "charge_already_refunded",
      type: "invalid_request_error",
      message: "Already refunded",
      statusCode: 400,
      requestId: "req_perm",
      declineCode: null,
    });
    // RPC court-circuite direct status='exhausted' sur permanent (T-102.2.b).
    vi.mocked(recordRefundAttempt).mockResolvedValue({
      incidentId: "inc-1",
      incidentStatus: "exhausted",
      attemptId: "att-1",
      attemptNumber: 1,
    });

    const res = await retryIncident({
      ...baseParams,
      kind: "admin",
      blockedReason: null,
      retryCount: 0,
      admin: makeAdmin(),
    });

    expect(res).toBe("failed_permanent_short_circuit");
    // INSERT notif avec short_circuit=true pour différenciation T-102.3 mail.
    expect(captured.notificationsInsert).toHaveLength(1);
    const notif = captured.notificationsInsert[0] as Record<string, unknown>;
    const meta = notif.metadata as Record<string, unknown>;
    expect(meta.short_circuit).toBe(true);
    expect(meta.stripe_error_code).toBe("charge_already_refunded");
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(String(consoleErrorSpy.mock.calls[0]?.[0])).toContain(
      "[REFUND_RETRY_PERMANENT]",
    );
  });
});

// =============================================================================
// E. Race R1 — recordRefundAttempt retourne null
// =============================================================================

describe("retryIncident — race R1 recordRefundAttempt null", () => {
  it("Stripe échec + RPC retourne null (UNIQUE violation race) → 'failed_will_retry' par défaut prudent", async () => {
    vi.mocked(stripe.refunds.create).mockRejectedValue(new Error("network"));
    (classifyRefundError as Mock).mockReturnValue({
      category: "safe_to_retry",
      code: null,
      type: null,
      message: "network",
      statusCode: null,
      requestId: null,
      declineCode: null,
    });
    vi.mocked(recordRefundAttempt).mockResolvedValue(null);

    const res = await retryIncident({
      ...baseParams,
      kind: "admin",
      blockedReason: null,
      admin: makeAdmin(),
    });

    expect(res).toBe("failed_will_retry");
    expect(captured.notificationsInsert).toEqual([]);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(String(consoleWarnSpy.mock.calls[0]?.[0])).toContain(
      "[REFUND_RETRY_RECORD_WARN]",
    );
  });
});

// =============================================================================
// F. consumerId null (RGPD) propagé
// =============================================================================

describe("retryIncident — consumerId null", () => {
  it("consumerId=null propagé à recordRefundAttempt (RGPD account deleted)", async () => {
    vi.mocked(stripe.refunds.create).mockResolvedValue({
      id: "re_rgpd",
    } as never);
    vi.mocked(recordRefundAttempt).mockResolvedValue({
      incidentId: "inc-1",
      incidentStatus: "succeeded",
      attemptId: "att-1",
      attemptNumber: 1,
    });

    await retryIncident({
      ...baseParams,
      consumerId: null,
      kind: "timeout",
      blockedReason: null,
      admin: makeAdmin(),
    });

    expect(recordRefundAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        consumerId: null,
        outcome: "succeeded",
      }),
    );
  });
});
