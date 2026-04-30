import type { SupabaseClient } from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe/server";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";
import type { RefundKind } from "@/lib/cron/build-retry-targets";

// Helper pure (testable isolément, pattern Phase 2 audit_logs symétrique
// à `handle-payment-succeeded.ts` / `handle-payment-failed.ts`) qui retente
// un refund Stripe précédemment échoué. T-412 : étendu aux 3 paths refund
// (revival / admin / timeout) via discriminator `kind`.
//
// Caller : `app/api/cron/retry-failed-refunds/route.ts` (cron daily 4h UTC,
// `0 4 * * *`). Le cron query audit_logs pour identifier les targets et
// délègue ici la décision atomique : tentative Stripe + audit log + UPDATE
// order si succès + notification admin si exhausted.
//
// Politique retry (validée 28/04, push back accepté contre brief initial
// `1h/6h/24h` incompatible avec daily cron) :
//   - Daily simple : 1 attempt par run, max 3 attempts cumulatifs.
//   - Au 3e échec consécutif → exhausted + notification admin.
//   - Backoff implicite = ~24h entre runs cron (acceptable, cas exceptionnel).
//
// Idempotency Stripe (CRITIQUE) : `idempotencyKey: refund_${order_id}_${kind}_${attempt}`.
// Empêche un double refund si :
//   - le cron run déclenche 2 fois (timeout Vercel, retry serverless),
//   - le même attempt est rejoué.
// La clé varie par (kind, attempt) — 2 paths refund différents qui auraient
// historiquement échoué sur la même order historiquement ne se collisionnent
// pas. Aligné avec TA Bundle 1 T-408 (`refund_${order_id}_${context}` initial,
// même valeurs `revival`/`admin`/`timeout`).
//
// Compteur attempts : la fonction reçoit `attempt` calculé en amont par le
// cron via `count(audit_logs.event_type IN [3 failed events] AND
// metadata->>'order_id'=X AND metadata->>'kind'=K)` + 1. Single source of
// truth = audit_logs (cohérent avec le pattern audit-log-driven background job).
//
// Sémantique retour :
//   - "succeeded" : refund OK → closure_reason posée + audit log
//     `order_refund_retried_succeeded` (avec metadata.kind). Order sort de
//     la query targets via le filtre composite (orderId, kind).
//   - "failed_will_retry" : refund a échoué, attempt < 3 → audit log
//     re-posté (event_type selon kind, metadata.kind présent) pour
//     incrémenter le compteur. Sera repris au prochain run quotidien.
//   - "failed_exhausted" : refund a échoué, attempt === 3 → 2 audit logs
//     posés (refund_failed kind + `order_refund_retry_exhausted` avec
//     metadata.kind) + notification `refund_retry_exhausted`. Order sort.
//
// État DB préservé en cas d'échec : on ne touche PAS l'order tant que le
// refund n'est pas confirmé Stripe (cf. handle-payment-succeeded.ts:236).
// L'order reste cancelled+payment_failed pour ne pas masquer son état réel
// vis-à-vis du consumer (paiement encaissé non refundé = état à refléter).

export type RetryRefundResult =
  | "succeeded"
  | "failed_will_retry"
  | "failed_exhausted";

export type RetryRefundParams = {
  orderId: string;
  paymentIntentId: string;
  kind: RefundKind;
  // 1, 2 ou 3 (calculé par le cron caller à partir du count audit_logs
  // groupé par (order_id, kind)).
  attempt: 1 | 2 | 3;
  // Repris depuis le metadata du dernier event refund_failed posé sur le
  // path resurrection. Sert à poser closure_reason côté UPDATE order
  // au succès du retry. Required uniquement si kind='revival'.
  blockedReason?: "blocked_stock" | "blocked_slot";
  consumerId: string | null;
  admin: SupabaseClient;
};

const MAX_ATTEMPTS = 3;

// Map kind → audit_log event_type pour le re-pose côté retry échoué (besoin
// du compteur côté buildRetryTargets pour calculer attempt+1).
const FAILED_EVENT_BY_KIND: Record<RefundKind, string> = {
  revival: "order_revival_refund_failed",
  admin: "order_admin_refund_failed",
  timeout: "order_timeout_refund_failed",
};

// Map kind → closure_reason posée sur l'order au succès retry.
// - revival : revival_blocked_stock / revival_blocked_slot (depuis blockedReason)
// - admin   : admin_refund (idempotent : déjà posée par /api/stripe/refund)
// - timeout : timeout (idempotent : déjà posée par cron order-timeout)
function closureReasonFor(
  kind: RefundKind,
  blockedReason?: "blocked_stock" | "blocked_slot",
): string {
  if (kind === "revival") {
    return blockedReason === "blocked_stock"
      ? "revival_blocked_stock"
      : "revival_blocked_slot";
  }
  if (kind === "admin") return "admin_refund";
  return "timeout";
}

export async function retryFailedRefund(
  params: RetryRefundParams,
): Promise<RetryRefundResult> {
  const {
    orderId,
    paymentIntentId,
    kind,
    attempt,
    blockedReason,
    consumerId,
    admin,
  } = params;

  const idempotencyKey = `refund_${orderId}_${kind}_${attempt}`;

  try {
    const refund = await stripe.refunds.create(
      { payment_intent: paymentIntentId },
      { idempotencyKey },
    );

    // UPDATE closure_reason adaptatif par kind. Statut reste cancelled,
    // cancelled_at reste figé. Symétrique au path nominal des call sites
    // initiaux (handle-payment-succeeded / refund admin / cron timeout).
    const closureReason = closureReasonFor(kind, blockedReason);

    const { error: updateError } = await admin
      .from("orders")
      .update({ closure_reason: closureReason })
      .eq("id", orderId);

    if (updateError) {
      // Drift : refund émis chez Stripe mais UPDATE DB a échoué. Préfixe
      // grep-able pour réconciliation manuelle (cohérent avec le pattern
      // [REFUND_DB_DRIFT] des autres refund paths).
      console.warn(
        `[REFUND_RETRY_DB_DRIFT] order=${orderId} kind=${kind} pi=${paymentIntentId} attempt=${attempt} refund_id=${refund.id} ${updateError.message}`,
      );
    }

    await logPaymentEvent({
      eventType: "order_refund_retried_succeeded",
      userId: consumerId,
      metadata: {
        order_id: orderId,
        payment_intent_id: paymentIntentId,
        kind,
        attempt,
        refund_id: refund.id,
        ...(blockedReason ? { blocked_reason: blockedReason } : {}),
      },
    });

    console.log(
      `[REFUND_RETRY_SUCCESS] order=${orderId} kind=${kind} pi=${paymentIntentId} attempt=${attempt} refund_id=${refund.id}`,
    );

    return "succeeded";
  } catch (refundErr) {
    const errorMessage = (refundErr as Error).message;

    // Re-pose un audit log refund_failed (event_type selon kind) pour
    // incrémenter le compteur — buildRetryTargets le compte par (orderId, kind)
    // pour déterminer le prochain attempt.
    await logPaymentEvent({
      eventType: FAILED_EVENT_BY_KIND[kind] as
        | "order_revival_refund_failed"
        | "order_admin_refund_failed"
        | "order_timeout_refund_failed",
      userId: consumerId,
      metadata: {
        order_id: orderId,
        payment_intent_id: paymentIntentId,
        kind,
        attempt,
        retry_error: errorMessage,
        ...(blockedReason ? { blocked_reason: blockedReason } : {}),
      },
    });

    if (attempt >= MAX_ATTEMPTS) {
      // Exhausted : pose un 2e event pour sortir l'order de la query
      // targets + insert notification admin (placeholder cohérent avec
      // webhook_anomaly_refund_failed inséré par le webhook initial).
      await logPaymentEvent({
        eventType: "order_refund_retry_exhausted",
        userId: consumerId,
        metadata: {
          order_id: orderId,
          payment_intent_id: paymentIntentId,
          kind,
          attempts_total: MAX_ATTEMPTS,
          last_error: errorMessage,
          ...(blockedReason ? { blocked_reason: blockedReason } : {}),
        },
      });

      // Best effort : si l'insert notif échoue (RLS, table down), on swallow
      // pour ne pas masquer l'event audit déjà posé. Préfixe grep-able.
      const { error: notifError } = await admin.from("notifications").insert({
        user_id: null,
        type: "email",
        template: "refund_retry_exhausted",
        statut: "failed",
        metadata: {
          order_id: orderId,
          payment_intent_id: paymentIntentId,
          kind,
          attempts_total: MAX_ATTEMPTS,
          last_error: errorMessage,
          ...(blockedReason ? { blocked_reason: blockedReason } : {}),
        },
      });

      if (notifError) {
        console.warn(
          `[REFUND_RETRY_NOTIF_WARN] order=${orderId} kind=${kind} pi=${paymentIntentId} ${notifError.message}`,
        );
      }

      console.error(
        `[REFUND_RETRY_EXHAUSTED] order=${orderId} kind=${kind} pi=${paymentIntentId} attempts=${MAX_ATTEMPTS} last_error=${errorMessage}`,
      );

      return "failed_exhausted";
    }

    console.warn(
      `[REFUND_RETRY_FAILED] order=${orderId} kind=${kind} pi=${paymentIntentId} attempt=${attempt} error=${errorMessage}`,
    );

    return "failed_will_retry";
  }
}
