import Stripe from "stripe";

/**
 * Module pure de classification des erreurs Stripe sur stripe.refunds.create
 * pour piloter la stratégie retry du chantier T-102 (refund_incidents).
 *
 * Posé par T-102.2.a. Pas encore consommé : T-102.2.b branchera les 3
 * call sites refund (admin manuel, cron timeout, résurrection) pour
 * INSERT refund_incidents/refund_incident_attempts ; T-102.2.c basculera
 * le cron retry-failed-refunds + helper retry-failed-refund.ts.
 *
 * Trois catégories :
 *   - safe_to_retry : transient identifié (rate limit, network, lock
 *     timeout, idempotency conflict, api 5xx). Le cron daily retentera.
 *   - permanent    : retry inutile (refund déjà émis, charge en dispute,
 *     compte fermé, balance plateforme insuffisante, params bug, …).
 *     Bascule directe en exhausted + alerte admin.
 *   - unknown      : sémantique floue côté refund (StripeCardError rare,
 *     processing_error, code Stripe non documenté). Retry prudent (jusqu'à
 *     max_retries) puis exhaust si toujours KO.
 *
 * Stratégie de dispatch (cf. T-102.2.a Étape 1, ordonnée) :
 *   1. Familles évidentes via instanceof :
 *      StripeRateLimitError / StripeConnectionError / StripeAPIError /
 *      StripeIdempotencyError                       → safe_to_retry
 *      StripeAuthenticationError / StripePermissionError /
 *      StripeInvalidGrantError / TemporarySessionExpiredError → permanent
 *   2. StripeInvalidRequestError : dispatch sur error.code via les 3 sets
 *      figés ci-dessous (PERMANENT_CODES, SAFE_TO_RETRY_CODES,
 *      UNKNOWN_CODES). 34 codes refund-relevant tranchés Étape 1.
 *   3. StripeCardError                              → unknown (prudent,
 *      cas exotique sur refund).
 *   4. Tout le reste (Error générique non-Stripe, StripeError fallback,
 *      throw d'un string, …)                        → unknown.
 *
 * Sources :
 *   - Doc Stripe error codes : https://docs.stripe.com/error-codes
 *     (166 codes documentés, 34 retenus refund-relevant après filtrage
 *     Étape 1).
 *   - Doc Stripe API errors  : https://docs.stripe.com/api/errors
 *     (4 types publics ; 8 RawErrorType + 11 classes côté SDK Node v17.2.0,
 *     cf. node_modules/stripe/types/Errors.d.ts).
 *
 * Décisions orchestrateur figées (Étape 1) :
 *   - 8 codes incertains (expired_card, card_declined, payment_method_*,
 *     debit_not_authorized) → tous PERMANENT.
 *   - balance_insufficient → PERMANENT (le mail T-102.3 enrichira son
 *     humanReason pour signaler l'action recharge plateforme).
 *   - processing_error / forwarding_api_upstream_error → UNKNOWN.
 *   - StripeCardError sur refund → UNKNOWN (jamais permanent direct,
 *     retry défensif limité par max_retries).
 *
 * Hors-périmètre :
 *   - Aucune I/O. Pure function : input erreur, output ClassifiedRefundError.
 *   - Pas de message human-readable FR ici. Le mail T-102.3 produira son
 *     wording sur la base de category + code (séparation responsabilités).
 *   - StripeSignatureVerificationError exclu : non atteignable depuis
 *     stripe.refunds.create (signature webhook uniquement).
 */

// ============================================================================
// Types publics
// ============================================================================

export const REFUND_ERROR_CATEGORIES = [
  "safe_to_retry",
  "permanent",
  "unknown",
] as const;

export type RefundErrorCategory = (typeof REFUND_ERROR_CATEGORIES)[number];

/**
 * Résultat enrichi de la classification — cohérent avec colonnes
 * refund_incident_attempts (T-102.1) :
 *   - code         → stripe_error_code
 *   - type         → stripe_error_type (rawType API-canonique privilégié,
 *                    fallback sur error.type = nom de classe sinon)
 *   - message      → stripe_error_message
 *   - requestId    → stripe_request_id (ticket support Stripe)
 *
 * statusCode et declineCode sont des bonus debug non persistés en T-102.1
 * mais utiles pour les logs greppables côté T-102.2.b/c.
 */
export type ClassifiedRefundError = {
  category: RefundErrorCategory;
  code: string | null;
  type: string | null;
  message: string;
  statusCode: number | null;
  requestId: string | null;
  declineCode: string | null;
};

// ============================================================================
// Helper type-guard exporté (réutilisable T-102.3 mail Resend)
// ============================================================================

export function isStripeError(e: unknown): e is Stripe.errors.StripeError {
  return e instanceof Stripe.errors.StripeError;
}

// ============================================================================
// Sets de codes refund-relevant (StripeInvalidRequestError dispatch)
// ============================================================================

const PERMANENT_CODES: ReadonlySet<string> = new Set([
  // Refund-spécifiques
  "charge_already_refunded",
  "charge_disputed",
  "refund_disputed_payment",
  "return_intent_already_processed",
  // PI / state
  "payment_intent_unexpected_state",
  "intent_invalid_state",
  "status_transition_invalid",
  // Amount / param logique
  "amount_too_large",
  "amount_too_small",
  "invalid_charge_amount",
  "charge_invalid_parameter",
  "parameter_invalid_empty",
  "parameter_invalid_integer",
  "parameter_missing",
  "parameter_unknown",
  "parameters_exclusive",
  // Resource
  "resource_missing",
  "resource_already_exists",
  // Account / config
  "account_invalid",
  "account_closed",
  "platform_account_required",
  "platform_api_key_expired",
  "api_key_expired",
  "secret_key_required",
  "livemode_mismatch",
  // Balance
  "balance_insufficient",
  // 8 incertains tranchés permanent (T-102.2.a Étape 1)
  "expired_card",
  "card_declined",
  "payment_method_not_available",
  "payment_method_provider_decline",
  "payment_method_provider_timeout",
  "payment_method_unactivated",
  "payment_method_unexpected_state",
  "debit_not_authorized",
]);

const SAFE_TO_RETRY_CODES: ReadonlySet<string> = new Set([
  "lock_timeout",
  "rate_limit",
  "idempotency_key_in_use",
  "forwarding_api_retryable_upstream_error",
  "forwarding_api_upstream_connection_error",
  "forwarding_api_upstream_connection_timeout",
]);

const UNKNOWN_CODES: ReadonlySet<string> = new Set([
  "processing_error",
  "forwarding_api_upstream_error",
]);

// ============================================================================
// Classification
// ============================================================================

function extractBase(error: Stripe.errors.StripeError): Omit<
  ClassifiedRefundError,
  "category"
> {
  // rawType (API-canonique : 'invalid_request_error', 'rate_limit_error', …)
  // privilégié sur type (nom de classe : 'StripeInvalidRequestError'). Cf
  // node_modules/stripe/types/Errors.d.ts v17.2.0 ; rawType peut être
  // undefined sur StripePermissionError / StripeConnectionError /
  // StripeSignatureVerificationError → fallback sur type.
  const rawTypeOrType =
    ("rawType" in error && typeof error.rawType === "string"
      ? error.rawType
      : null) ??
    (typeof error.type === "string" ? error.type : null);

  return {
    code: error.code ?? null,
    type: rawTypeOrType,
    message: error.message,
    statusCode: error.statusCode ?? null,
    requestId: error.requestId ?? null,
    declineCode: error.decline_code ?? null,
  };
}

export function classifyRefundError(error: unknown): ClassifiedRefundError {
  if (!isStripeError(error)) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Unknown non-Stripe error";
    return {
      category: "unknown",
      code: null,
      type: null,
      message,
      statusCode: null,
      requestId: null,
      declineCode: null,
    };
  }

  const base = extractBase(error);

  // 1. Familles transient (safe_to_retry) — ordre des plus fréquents.
  if (
    error instanceof Stripe.errors.StripeRateLimitError ||
    error instanceof Stripe.errors.StripeConnectionError ||
    error instanceof Stripe.errors.StripeAPIError ||
    error instanceof Stripe.errors.StripeIdempotencyError
  ) {
    return { ...base, category: "safe_to_retry" };
  }

  // 2. Familles permanentes — retry inutile.
  if (
    error instanceof Stripe.errors.StripeAuthenticationError ||
    error instanceof Stripe.errors.StripePermissionError ||
    error instanceof Stripe.errors.StripeInvalidGrantError ||
    error instanceof Stripe.errors.TemporarySessionExpiredError
  ) {
    return { ...base, category: "permanent" };
  }

  // 3. StripeInvalidRequestError : dispatch par error.code.
  if (error instanceof Stripe.errors.StripeInvalidRequestError) {
    if (base.code !== null) {
      if (PERMANENT_CODES.has(base.code)) {
        return { ...base, category: "permanent" };
      }
      if (SAFE_TO_RETRY_CODES.has(base.code)) {
        return { ...base, category: "safe_to_retry" };
      }
      if (UNKNOWN_CODES.has(base.code)) {
        return { ...base, category: "unknown" };
      }
    }
    return { ...base, category: "unknown" };
  }

  // 4. StripeCardError — décision orchestrateur : unknown (jamais permanent
  // direct, retry défensif limité par max_retries).
  if (error instanceof Stripe.errors.StripeCardError) {
    return { ...base, category: "unknown" };
  }

  // 5. Fallback ultime : StripeError sans sous-classe matchée.
  return { ...base, category: "unknown" };
}
