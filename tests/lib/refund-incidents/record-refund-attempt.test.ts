import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

// Mock Supabase admin avec capture de l'appel rpc("record_refund_attempt", ...).
// rpcSpy typé Mock pour exposer mockResolvedValue / mockRejectedValue / mock.calls.
let rpcSpy: Mock;

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    rpc: (fn: string, args: unknown) => rpcSpy(fn, args),
  }),
}));

import { recordRefundAttempt } from "@/lib/refund-incidents/record-refund-attempt";
import type { ClassifiedRefundError } from "@/lib/refund-incidents/classify-error";

let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
let consoleLogSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  rpcSpy = vi.fn();
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const baseClassifiedSafeRetry: ClassifiedRefundError = {
  category: "safe_to_retry",
  code: "lock_timeout",
  type: "invalid_request_error",
  message: "lock acquired",
  statusCode: 400,
  requestId: "req_safe_1",
  declineCode: null,
};

const baseClassifiedPermanent: ClassifiedRefundError = {
  category: "permanent",
  code: "charge_already_refunded",
  type: "invalid_request_error",
  message: "Already refunded",
  statusCode: 400,
  requestId: "req_perm_1",
  declineCode: null,
};

const baseClassifiedUnknown: ClassifiedRefundError = {
  category: "unknown",
  code: null,
  type: null,
  message: "Some random error",
  statusCode: null,
  requestId: null,
  declineCode: null,
};

const successRpcRow = (status: string, attemptNumber: number) => [
  {
    incident_id: "inc_xyz",
    incident_status: status,
    attempt_id: "att_xyz",
    attempt_number: attemptNumber,
  },
];

// =============================================================================
// A. RPC call wiring — vérifier les 13 paramètres p_* passés
// =============================================================================

describe("recordRefundAttempt — RPC call wiring", () => {
  it("passe les 13 paramètres p_* à la RPC + utilise firstFailedEventAt fourni", async () => {
    rpcSpy.mockResolvedValue({
      data: successRpcRow("pending", 1),
      error: null,
    });

    const fixedDate = new Date("2026-05-02T10:00:00.000Z");
    await recordRefundAttempt({
      orderId: "order-1",
      kind: "revival",
      paymentIntentId: "pi_1",
      consumerId: "user-7",
      blockedReason: "blocked_stock",
      outcome: "failed",
      classified: baseClassifiedSafeRetry,
      firstFailedEventAt: fixedDate,
    });

    expect(rpcSpy).toHaveBeenCalledTimes(1);
    expect(rpcSpy).toHaveBeenCalledWith("record_refund_attempt", {
      p_order_id: "order-1",
      p_kind: "revival",
      p_payment_intent_id: "pi_1",
      p_consumer_id: "user-7",
      p_blocked_reason: "blocked_stock",
      p_outcome: "failed",
      p_stripe_error_code: "lock_timeout",
      p_stripe_error_type: "invalid_request_error",
      p_stripe_error_message: "lock acquired",
      p_stripe_request_id: "req_safe_1",
      p_stripe_refund_id: null,
      p_classification: "safe_to_retry",
      p_first_failed_event_at: "2026-05-02T10:00:00.000Z",
    });
  });

  it("utilise new Date() comme défaut si firstFailedEventAt absent", async () => {
    rpcSpy.mockResolvedValue({
      data: successRpcRow("pending", 1),
      error: null,
    });

    const before = Date.now();
    await recordRefundAttempt({
      orderId: "order-2",
      kind: "admin",
      paymentIntentId: "pi_2",
      consumerId: null,
      outcome: "failed",
      classified: baseClassifiedSafeRetry,
    });
    const after = Date.now();

    const args = rpcSpy.mock.calls[0]![1] as {
      p_first_failed_event_at: string;
    };
    const tsMs = new Date(args.p_first_failed_event_at).getTime();
    expect(tsMs).toBeGreaterThanOrEqual(before);
    expect(tsMs).toBeLessThanOrEqual(after);
  });
});

// =============================================================================
// B. Mapping classified → paramètres RPC
// =============================================================================

describe("recordRefundAttempt — mapping classified → params", () => {
  it("classified.category=safe_to_retry → p_classification='safe_to_retry'", async () => {
    rpcSpy.mockResolvedValue({
      data: successRpcRow("pending", 1),
      error: null,
    });
    await recordRefundAttempt({
      orderId: "o1",
      kind: "admin",
      paymentIntentId: "pi_1",
      consumerId: null,
      outcome: "failed",
      classified: baseClassifiedSafeRetry,
    });
    const args = rpcSpy.mock.calls[0]![1] as { p_classification: string };
    expect(args.p_classification).toBe("safe_to_retry");
  });

  it("classified.category=permanent → p_classification='permanent'", async () => {
    rpcSpy.mockResolvedValue({
      data: successRpcRow("exhausted", 1),
      error: null,
    });
    await recordRefundAttempt({
      orderId: "o1",
      kind: "admin",
      paymentIntentId: "pi_1",
      consumerId: null,
      outcome: "failed",
      classified: baseClassifiedPermanent,
    });
    const args = rpcSpy.mock.calls[0]![1] as { p_classification: string };
    expect(args.p_classification).toBe("permanent");
  });

  it("classified.category=unknown → p_classification='unknown' + code/type/requestId null persistés", async () => {
    rpcSpy.mockResolvedValue({
      data: successRpcRow("pending", 1),
      error: null,
    });
    await recordRefundAttempt({
      orderId: "o1",
      kind: "admin",
      paymentIntentId: "pi_1",
      consumerId: null,
      outcome: "failed",
      classified: baseClassifiedUnknown,
    });
    const args = rpcSpy.mock.calls[0]![1] as Record<string, unknown>;
    expect(args.p_classification).toBe("unknown");
    expect(args.p_stripe_error_code).toBeNull();
    expect(args.p_stripe_error_type).toBeNull();
    expect(args.p_stripe_request_id).toBeNull();
    expect(args.p_stripe_error_message).toBe("Some random error");
  });

  it("classified=null (succès) → tous les p_stripe_error_* null + p_classification null", async () => {
    rpcSpy.mockResolvedValue({
      data: successRpcRow("succeeded", 2),
      error: null,
    });
    await recordRefundAttempt({
      orderId: "o1",
      kind: "revival",
      paymentIntentId: "pi_1",
      consumerId: "u1",
      blockedReason: "blocked_stock",
      outcome: "succeeded",
      stripeRefundId: "re_xyz",
      classified: null,
    });
    const args = rpcSpy.mock.calls[0]![1] as Record<string, unknown>;
    expect(args.p_classification).toBeNull();
    expect(args.p_stripe_error_code).toBeNull();
    expect(args.p_stripe_error_type).toBeNull();
    expect(args.p_stripe_error_message).toBeNull();
    expect(args.p_stripe_request_id).toBeNull();
    expect(args.p_stripe_refund_id).toBe("re_xyz");
    expect(args.p_outcome).toBe("succeeded");
  });
});

// =============================================================================
// C. Kinds (revival / admin / timeout) + blockedReason
// =============================================================================

describe("recordRefundAttempt — kinds et blockedReason", () => {
  it("kind='revival' avec blockedReason='blocked_stock'", async () => {
    rpcSpy.mockResolvedValue({
      data: successRpcRow("pending", 1),
      error: null,
    });
    await recordRefundAttempt({
      orderId: "o1",
      kind: "revival",
      paymentIntentId: "pi_1",
      consumerId: "u1",
      blockedReason: "blocked_stock",
      outcome: "failed",
      classified: baseClassifiedSafeRetry,
    });
    const args = rpcSpy.mock.calls[0]![1] as Record<string, unknown>;
    expect(args.p_kind).toBe("revival");
    expect(args.p_blocked_reason).toBe("blocked_stock");
  });

  it("kind='revival' avec blockedReason='blocked_slot'", async () => {
    rpcSpy.mockResolvedValue({
      data: successRpcRow("pending", 1),
      error: null,
    });
    await recordRefundAttempt({
      orderId: "o1",
      kind: "revival",
      paymentIntentId: "pi_1",
      consumerId: "u1",
      blockedReason: "blocked_slot",
      outcome: "failed",
      classified: baseClassifiedSafeRetry,
    });
    const args = rpcSpy.mock.calls[0]![1] as Record<string, unknown>;
    expect(args.p_blocked_reason).toBe("blocked_slot");
  });

  it("kind='admin' avec blockedReason omis → null persisté", async () => {
    rpcSpy.mockResolvedValue({
      data: successRpcRow("pending", 1),
      error: null,
    });
    await recordRefundAttempt({
      orderId: "o1",
      kind: "admin",
      paymentIntentId: "pi_1",
      consumerId: "u1",
      outcome: "failed",
      classified: baseClassifiedSafeRetry,
    });
    const args = rpcSpy.mock.calls[0]![1] as Record<string, unknown>;
    expect(args.p_kind).toBe("admin");
    expect(args.p_blocked_reason).toBeNull();
  });

  it("kind='timeout' avec blockedReason=null explicite → null persisté", async () => {
    rpcSpy.mockResolvedValue({
      data: successRpcRow("pending", 1),
      error: null,
    });
    await recordRefundAttempt({
      orderId: "o1",
      kind: "timeout",
      paymentIntentId: "pi_1",
      consumerId: "u1",
      blockedReason: null,
      outcome: "failed",
      classified: baseClassifiedSafeRetry,
    });
    const args = rpcSpy.mock.calls[0]![1] as Record<string, unknown>;
    expect(args.p_kind).toBe("timeout");
    expect(args.p_blocked_reason).toBeNull();
  });

  it("consumerId=null (RGPD) → p_consumer_id null persisté, pas de crash", async () => {
    rpcSpy.mockResolvedValue({
      data: successRpcRow("pending", 1),
      error: null,
    });
    const out = await recordRefundAttempt({
      orderId: "o1",
      kind: "admin",
      paymentIntentId: "pi_1",
      consumerId: null,
      outcome: "failed",
      classified: baseClassifiedSafeRetry,
    });
    const args = rpcSpy.mock.calls[0]![1] as Record<string, unknown>;
    expect(args.p_consumer_id).toBeNull();
    expect(out).not.toBeNull();
  });
});

// =============================================================================
// D. Logs greppables (Q7 orchestrateur)
// =============================================================================

describe("recordRefundAttempt — logs greppables Vercel", () => {
  it("outcome=failed + safe_to_retry → console.log [REFUND_INCIDENT_RECORDED]", async () => {
    rpcSpy.mockResolvedValue({
      data: successRpcRow("pending", 1),
      error: null,
    });
    await recordRefundAttempt({
      orderId: "o1",
      kind: "admin",
      paymentIntentId: "pi_1",
      consumerId: null,
      outcome: "failed",
      classified: baseClassifiedSafeRetry,
    });
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    expect(String(consoleLogSpy.mock.calls[0]?.[0])).toContain(
      "[REFUND_INCIDENT_RECORDED]",
    );
    expect(String(consoleLogSpy.mock.calls[0]?.[0])).toContain(
      "outcome=failed",
    );
    expect(String(consoleLogSpy.mock.calls[0]?.[0])).toContain("attempt=1");
  });

  it("outcome=failed + permanent → console.warn [REFUND_INCIDENT_PERMANENT_EXHAUST]", async () => {
    rpcSpy.mockResolvedValue({
      data: successRpcRow("exhausted", 1),
      error: null,
    });
    await recordRefundAttempt({
      orderId: "o1",
      kind: "admin",
      paymentIntentId: "pi_1",
      consumerId: null,
      outcome: "failed",
      classified: baseClassifiedPermanent,
    });
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(String(consoleWarnSpy.mock.calls[0]?.[0])).toContain(
      "[REFUND_INCIDENT_PERMANENT_EXHAUST]",
    );
    expect(String(consoleWarnSpy.mock.calls[0]?.[0])).toContain(
      "code=charge_already_refunded",
    );
    // Pas de console.log [REFUND_INCIDENT_RECORDED] sur permanent.
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it("outcome=succeeded → console.log [REFUND_INCIDENT_RECORDED] (pas EXHAUST)", async () => {
    rpcSpy.mockResolvedValue({
      data: successRpcRow("succeeded", 2),
      error: null,
    });
    await recordRefundAttempt({
      orderId: "o1",
      kind: "revival",
      paymentIntentId: "pi_1",
      consumerId: "u1",
      blockedReason: "blocked_slot",
      outcome: "succeeded",
      stripeRefundId: "re_ok",
    });
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    expect(String(consoleLogSpy.mock.calls[0]?.[0])).toContain(
      "[REFUND_INCIDENT_RECORDED]",
    );
    expect(String(consoleLogSpy.mock.calls[0]?.[0])).toContain(
      "outcome=succeeded",
    );
    expect(String(consoleLogSpy.mock.calls[0]?.[0])).toContain(
      "status=succeeded",
    );
  });
});

// =============================================================================
// E. Fail-safe (RPC error, exception, no rows)
// =============================================================================

describe("recordRefundAttempt — fail-safe", () => {
  it("RPC retourne error → console.warn [REFUND_INCIDENT_INSERT_WARN] + return null", async () => {
    rpcSpy.mockResolvedValue({
      data: null,
      error: { message: "function does not exist" },
    });
    const out = await recordRefundAttempt({
      orderId: "o1",
      kind: "admin",
      paymentIntentId: "pi_1",
      consumerId: null,
      outcome: "failed",
      classified: baseClassifiedSafeRetry,
    });
    expect(out).toBeNull();
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(String(consoleWarnSpy.mock.calls[0]?.[0])).toContain(
      "[REFUND_INCIDENT_INSERT_WARN]",
    );
    expect(String(consoleWarnSpy.mock.calls[0]?.[0])).toContain(
      "function does not exist",
    );
  });

  it("RPC throw exception → console.warn [REFUND_INCIDENT_INSERT_WARN] avec exception=… + return null", async () => {
    rpcSpy.mockRejectedValue(new Error("network timeout"));
    const out = await recordRefundAttempt({
      orderId: "o1",
      kind: "admin",
      paymentIntentId: "pi_1",
      consumerId: null,
      outcome: "failed",
      classified: baseClassifiedSafeRetry,
    });
    expect(out).toBeNull();
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(String(consoleWarnSpy.mock.calls[0]?.[0])).toContain(
      "exception=network timeout",
    );
  });

  it("RPC retourne data=[] (no rows) → console.warn no rows + return null", async () => {
    rpcSpy.mockResolvedValue({ data: [], error: null });
    const out = await recordRefundAttempt({
      orderId: "o1",
      kind: "admin",
      paymentIntentId: "pi_1",
      consumerId: null,
      outcome: "failed",
      classified: baseClassifiedSafeRetry,
    });
    expect(out).toBeNull();
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(String(consoleWarnSpy.mock.calls[0]?.[0])).toContain("no rows");
  });

  it("RPC retourne data=null → no rows + return null", async () => {
    rpcSpy.mockResolvedValue({ data: null, error: null });
    const out = await recordRefundAttempt({
      orderId: "o1",
      kind: "admin",
      paymentIntentId: "pi_1",
      consumerId: null,
      outcome: "failed",
      classified: baseClassifiedSafeRetry,
    });
    expect(out).toBeNull();
  });
});

// =============================================================================
// F. Retour structuré
// =============================================================================

describe("recordRefundAttempt — retour structuré", () => {
  it("succès RPC → retourne { incidentId, incidentStatus, attemptId, attemptNumber }", async () => {
    rpcSpy.mockResolvedValue({
      data: [
        {
          incident_id: "inc_42",
          incident_status: "retrying",
          attempt_id: "att_42",
          attempt_number: 2,
        },
      ],
      error: null,
    });
    const out = await recordRefundAttempt({
      orderId: "o1",
      kind: "timeout",
      paymentIntentId: "pi_1",
      consumerId: "u1",
      outcome: "failed",
      classified: baseClassifiedSafeRetry,
    });
    expect(out).toEqual({
      incidentId: "inc_42",
      incidentStatus: "retrying",
      attemptId: "att_42",
      attemptNumber: 2,
    });
  });
});
