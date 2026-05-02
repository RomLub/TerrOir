import { describe, it, expect, vi } from "vitest";

// Pattern hoisted (cf. tests/app/api/stripe/create-payment-intent/route.test.ts:14-52
// — Pattern C cartographié en T-102.2.a inspection §7) : on injecte de
// vraies classes Stripe.errors.* extends d'une StripeError parent commune.
// Le module production utilise `instanceof Stripe.errors.StripeXxxError` —
// pour valider la chaîne de dispatch, il faut que les instances créées en
// test soient bien `instanceof` les classes vues par le module ⇒ même
// référence de classe injectée via vi.mock.

const {
  StripeError,
  StripeRateLimitError,
  StripeConnectionError,
  StripeAPIError,
  StripeIdempotencyError,
  StripeAuthenticationError,
  StripePermissionError,
  StripeInvalidGrantError,
  TemporarySessionExpiredError,
  StripeInvalidRequestError,
  StripeCardError,
} = vi.hoisted(() => {
  type ErrorOpts = {
    message: string;
    code?: string;
    statusCode?: number;
    requestId?: string;
    rawType?: string;
    decline_code?: string;
  };

  class StripeError extends Error {
    readonly type: string;
    readonly rawType?: string;
    readonly code?: string;
    readonly statusCode?: number;
    readonly requestId: string;
    readonly decline_code?: string;
    constructor(opts: ErrorOpts, className = "StripeError") {
      super(opts.message);
      this.name = className;
      this.type = className;
      this.rawType = opts.rawType;
      this.code = opts.code;
      this.statusCode = opts.statusCode;
      this.requestId = opts.requestId ?? "";
      this.decline_code = opts.decline_code;
    }
  }
  class StripeRateLimitError extends StripeError {
    constructor(opts: ErrorOpts) {
      super({ ...opts, rawType: "rate_limit_error" }, "StripeRateLimitError");
    }
  }
  class StripeConnectionError extends StripeError {
    constructor(opts: ErrorOpts) {
      super(opts, "StripeConnectionError");
    }
  }
  class StripeAPIError extends StripeError {
    constructor(opts: ErrorOpts) {
      super({ ...opts, rawType: "api_error" }, "StripeAPIError");
    }
  }
  class StripeIdempotencyError extends StripeError {
    constructor(opts: ErrorOpts) {
      super(
        { ...opts, rawType: "idempotency_error" },
        "StripeIdempotencyError",
      );
    }
  }
  class StripeAuthenticationError extends StripeError {
    constructor(opts: ErrorOpts) {
      super(
        { ...opts, rawType: "authentication_error" },
        "StripeAuthenticationError",
      );
    }
  }
  class StripePermissionError extends StripeError {
    constructor(opts: ErrorOpts) {
      super(opts, "StripePermissionError");
    }
  }
  class StripeInvalidGrantError extends StripeError {
    constructor(opts: ErrorOpts) {
      super({ ...opts, rawType: "invalid_grant" }, "StripeInvalidGrantError");
    }
  }
  class TemporarySessionExpiredError extends StripeError {
    constructor(opts: ErrorOpts) {
      super(
        { ...opts, rawType: "temporary_session_expired" },
        "TemporarySessionExpiredError",
      );
    }
  }
  class StripeInvalidRequestError extends StripeError {
    constructor(opts: ErrorOpts) {
      super(
        { ...opts, rawType: "invalid_request_error" },
        "StripeInvalidRequestError",
      );
    }
  }
  class StripeCardError extends StripeError {
    constructor(opts: ErrorOpts) {
      super({ ...opts, rawType: "card_error" }, "StripeCardError");
    }
  }
  return {
    StripeError,
    StripeRateLimitError,
    StripeConnectionError,
    StripeAPIError,
    StripeIdempotencyError,
    StripeAuthenticationError,
    StripePermissionError,
    StripeInvalidGrantError,
    TemporarySessionExpiredError,
    StripeInvalidRequestError,
    StripeCardError,
  };
});

vi.mock("stripe", () => {
  const Stripe = function () {} as unknown as {
    errors: Record<string, unknown>;
  };
  Stripe.errors = {
    StripeError,
    StripeRateLimitError,
    StripeConnectionError,
    StripeAPIError,
    StripeIdempotencyError,
    StripeAuthenticationError,
    StripePermissionError,
    StripeInvalidGrantError,
    TemporarySessionExpiredError,
    StripeInvalidRequestError,
    StripeCardError,
  };
  return { default: Stripe };
});

import {
  classifyRefundError,
  isStripeError,
  REFUND_ERROR_CATEGORIES,
} from "@/lib/refund-incidents/classify-error";

// =============================================================================
// A. Type-driven dispatch (1 test par sous-classe Stripe.errors)
// =============================================================================

describe("classifyRefundError — type-driven dispatch (familles évidentes)", () => {
  it("StripeRateLimitError → safe_to_retry + rawType préservé", () => {
    const err = new StripeRateLimitError({
      message: "Too many requests",
      statusCode: 429,
      requestId: "req_rate1",
    });
    const out = classifyRefundError(err);
    expect(out.category).toBe("safe_to_retry");
    expect(out.type).toBe("rate_limit_error");
    expect(out.message).toBe("Too many requests");
    expect(out.statusCode).toBe(429);
    expect(out.requestId).toBe("req_rate1");
  });

  it("StripeConnectionError → safe_to_retry (rawType absent → fallback type=class)", () => {
    const err = new StripeConnectionError({ message: "TLS handshake failed" });
    const out = classifyRefundError(err);
    expect(out.category).toBe("safe_to_retry");
    // rawType non défini sur StripeConnectionError → fallback sur class name.
    expect(out.type).toBe("StripeConnectionError");
  });

  it("StripeAPIError → safe_to_retry (5xx Stripe servers)", () => {
    const err = new StripeAPIError({
      message: "Internal server error",
      statusCode: 500,
    });
    const out = classifyRefundError(err);
    expect(out.category).toBe("safe_to_retry");
    expect(out.type).toBe("api_error");
    expect(out.statusCode).toBe(500);
  });

  it("StripeIdempotencyError → safe_to_retry", () => {
    const err = new StripeIdempotencyError({
      message: "Idempotency key reused with different params",
      statusCode: 409,
    });
    const out = classifyRefundError(err);
    expect(out.category).toBe("safe_to_retry");
    expect(out.type).toBe("idempotency_error");
  });

  it("StripeAuthenticationError → permanent (clé API invalide)", () => {
    const err = new StripeAuthenticationError({
      message: "Invalid API Key provided",
      statusCode: 401,
    });
    const out = classifyRefundError(err);
    expect(out.category).toBe("permanent");
    expect(out.type).toBe("authentication_error");
  });

  it("StripePermissionError → permanent (rawType absent → fallback type=class)", () => {
    const err = new StripePermissionError({ message: "Access not allowed" });
    const out = classifyRefundError(err);
    expect(out.category).toBe("permanent");
    expect(out.type).toBe("StripePermissionError");
  });

  it("StripeInvalidGrantError → permanent (OAuth Connect)", () => {
    const err = new StripeInvalidGrantError({
      message: "Invalid OAuth code",
    });
    const out = classifyRefundError(err);
    expect(out.category).toBe("permanent");
    expect(out.type).toBe("invalid_grant");
  });

  it("TemporarySessionExpiredError → permanent", () => {
    const err = new TemporarySessionExpiredError({
      message: "Ephemeral session expired",
    });
    const out = classifyRefundError(err);
    expect(out.category).toBe("permanent");
    expect(out.type).toBe("temporary_session_expired");
  });

  it("StripeCardError → unknown (cas exotique sur refund, retry défensif)", () => {
    const err = new StripeCardError({
      message: "Carte refusée",
      code: "card_declined",
      decline_code: "insufficient_funds",
    });
    const out = classifyRefundError(err);
    expect(out.category).toBe("unknown");
    expect(out.type).toBe("card_error");
    expect(out.code).toBe("card_declined");
    expect(out.declineCode).toBe("insufficient_funds");
  });
});

// =============================================================================
// B. Code-driven dispatch (StripeInvalidRequestError)
// =============================================================================

describe("classifyRefundError — StripeInvalidRequestError code → permanent", () => {
  it.each([
    "charge_already_refunded",
    "charge_disputed",
    "refund_disputed_payment",
    "payment_intent_unexpected_state",
    "balance_insufficient",
    "account_closed",
    "amount_too_large",
    "resource_missing",
    "expired_card",
    "card_declined",
    "debit_not_authorized",
    "platform_api_key_expired",
    "status_transition_invalid",
  ])("code=%s → permanent", (code) => {
    const err = new StripeInvalidRequestError({
      message: `error ${code}`,
      code,
      statusCode: 400,
      requestId: `req_${code}`,
    });
    const out = classifyRefundError(err);
    expect(out.category).toBe("permanent");
    expect(out.code).toBe(code);
    expect(out.type).toBe("invalid_request_error");
    expect(out.requestId).toBe(`req_${code}`);
  });
});

describe("classifyRefundError — StripeInvalidRequestError code → safe_to_retry", () => {
  it.each([
    "lock_timeout",
    "rate_limit",
    "idempotency_key_in_use",
    "forwarding_api_retryable_upstream_error",
    "forwarding_api_upstream_connection_error",
    "forwarding_api_upstream_connection_timeout",
  ])("code=%s → safe_to_retry", (code) => {
    const err = new StripeInvalidRequestError({
      message: `transient ${code}`,
      code,
    });
    const out = classifyRefundError(err);
    expect(out.category).toBe("safe_to_retry");
    expect(out.code).toBe(code);
  });
});

describe("classifyRefundError — StripeInvalidRequestError code → unknown", () => {
  it.each(["processing_error", "forwarding_api_upstream_error"])(
    "code=%s → unknown (sémantique floue refund)",
    (code) => {
      const err = new StripeInvalidRequestError({
        message: `ambiguous ${code}`,
        code,
      });
      const out = classifyRefundError(err);
      expect(out.category).toBe("unknown");
      expect(out.code).toBe(code);
    },
  );

  it("code Stripe non documenté → unknown fallback", () => {
    const err = new StripeInvalidRequestError({
      message: "future Stripe error",
      code: "totally_new_stripe_code_not_in_any_set",
    });
    const out = classifyRefundError(err);
    expect(out.category).toBe("unknown");
    expect(out.code).toBe("totally_new_stripe_code_not_in_any_set");
  });

  it("StripeInvalidRequestError sans code → unknown fallback", () => {
    const err = new StripeInvalidRequestError({ message: "no code" });
    const out = classifyRefundError(err);
    expect(out.category).toBe("unknown");
    expect(out.code).toBeNull();
    expect(out.type).toBe("invalid_request_error");
  });
});

// =============================================================================
// C. Cas non-Stripe
// =============================================================================

describe("classifyRefundError — non-Stripe errors", () => {
  it('Error générique "network down" → unknown, code/type/requestId null, message préservé', () => {
    const err = new Error("network down");
    const out = classifyRefundError(err);
    expect(out).toEqual({
      category: "unknown",
      code: null,
      type: null,
      message: "network down",
      statusCode: null,
      requestId: null,
      declineCode: null,
    });
  });

  it("string nu lancé via throw → unknown, message=string", () => {
    const out = classifyRefundError("totally raw string error");
    expect(out.category).toBe("unknown");
    expect(out.message).toBe("totally raw string error");
    expect(out.code).toBeNull();
    expect(out.type).toBeNull();
  });

  it("objet POJO non-Error → unknown, message=fallback", () => {
    const out = classifyRefundError({ random: "object" });
    expect(out.category).toBe("unknown");
    expect(out.message).toBe("Unknown non-Stripe error");
  });

  it("undefined → unknown", () => {
    const out = classifyRefundError(undefined);
    expect(out.category).toBe("unknown");
  });
});

// =============================================================================
// D. Extraction champs enrichis (cohérence avec colonnes refund_incident_attempts)
// =============================================================================

describe("classifyRefundError — extraction des champs Stripe enrichis", () => {
  it("StripeInvalidRequestError : code, type, statusCode, requestId persistables", () => {
    const err = new StripeInvalidRequestError({
      message: "Cannot refund disputed charge",
      code: "charge_disputed",
      statusCode: 400,
      requestId: "req_abcdef123456",
    });
    const out = classifyRefundError(err);
    expect(out).toEqual({
      category: "permanent",
      code: "charge_disputed",
      type: "invalid_request_error",
      message: "Cannot refund disputed charge",
      statusCode: 400,
      requestId: "req_abcdef123456",
      declineCode: null,
    });
  });

  it("StripeCardError : declineCode bonus debug propagé", () => {
    const err = new StripeCardError({
      message: "Your card was declined.",
      code: "card_declined",
      statusCode: 402,
      requestId: "req_card_xyz",
      decline_code: "do_not_honor",
    });
    const out = classifyRefundError(err);
    expect(out.declineCode).toBe("do_not_honor");
    expect(out.code).toBe("card_declined");
    expect(out.statusCode).toBe(402);
  });
});

// =============================================================================
// E. Cohérence constants vs runtime (anti-régression contrat orchestrateur)
// =============================================================================

describe("classifyRefundError — contrat orchestrateur", () => {
  it("REFUND_ERROR_CATEGORIES contient exactement les 3 valeurs validées", () => {
    expect([...REFUND_ERROR_CATEGORIES].sort()).toEqual([
      "permanent",
      "safe_to_retry",
      "unknown",
    ]);
  });

  it("isStripeError(new Error()) === false", () => {
    expect(isStripeError(new Error("plain"))).toBe(false);
  });

  it("isStripeError(new Stripe.errors.StripeRateLimitError()) === true", () => {
    const err = new StripeRateLimitError({ message: "throttled" });
    expect(isStripeError(err)).toBe(true);
  });

  it("isStripeError sur sous-classe arbitraire → true (chaîne instanceof StripeError parent)", () => {
    const err = new StripeInvalidRequestError({
      message: "x",
      code: "lock_timeout",
    });
    expect(isStripeError(err)).toBe(true);
  });

  it("isStripeError(string) === false", () => {
    expect(isStripeError("not a stripe error")).toBe(false);
  });

  it("isStripeError(null) === false", () => {
    expect(isStripeError(null)).toBe(false);
  });

  it("classifyRefundError retourne toujours une category ∈ REFUND_ERROR_CATEGORIES", () => {
    const samples: unknown[] = [
      new StripeRateLimitError({ message: "1" }),
      new StripeAuthenticationError({ message: "2" }),
      new StripeInvalidRequestError({
        message: "3",
        code: "charge_already_refunded",
      }),
      new StripeInvalidRequestError({ message: "4", code: "lock_timeout" }),
      new StripeInvalidRequestError({
        message: "5",
        code: "processing_error",
      }),
      new StripeInvalidRequestError({
        message: "6",
        code: "completely_unknown_code",
      }),
      new StripeCardError({ message: "7" }),
      new Error("8"),
      "9 raw string",
      undefined,
    ];
    for (const s of samples) {
      const out = classifyRefundError(s);
      expect(REFUND_ERROR_CATEGORIES).toContain(out.category);
    }
  });
});
