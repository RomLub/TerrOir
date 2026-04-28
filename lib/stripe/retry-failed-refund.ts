import type { SupabaseClient } from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe/server";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";

// Helper pure (testable isolément, pattern Phase 2 audit_logs symétrique
// à `handle-payment-succeeded.ts` / `handle-payment-failed.ts`) qui retente
// un refund Stripe précédemment échoué sur le path résurrection bloquée.
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
// Idempotency Stripe (CRITIQUE) : `idempotencyKey: refund_${order_id}_${attempt}`
// passée au SDK. Empêche un double refund si :
//   - le cron run déclenche 2 fois (timeout Vercel, retry serverless),
//   - le même attempt est rejoué.
// La clé varie par attempt pour qu'un attempt N+1 ne soit pas bloqué par
// l'idempotency conflict du précédent appel persisté côté Stripe.
//
// Compteur attempts : la fonction reçoit `attempt` calculé en amont par le
// cron via `count(audit_logs.event_type='order_revival_refund_failed' AND
// metadata->>'order_id'=X)` + 1. Single source of truth = audit_logs
// (cohérent avec le pattern audit-log-driven background job).
//
// Sémantique retour :
//   - "succeeded" : refund OK → cancellation_reason posée + audit log
//     `order_refund_retried_succeeded`. Order sort de la query targets via
//     le filtre NOT EXISTS du cron.
//   - "failed_will_retry" : refund a échoué, attempt < 3 → audit log
//     `order_revival_refund_failed` re-posté pour incrémenter le compteur.
//     Sera repris au prochain run quotidien.
//   - "failed_exhausted" : refund a échoué, attempt === 3 → 2 audit logs
//     posés (`order_revival_refund_failed` + `order_refund_retry_exhausted`)
//     + notification `refund_retry_exhausted`. Order sort de la query.
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
  // 1, 2 ou 3 (calculé par le cron caller à partir du count audit_logs).
  attempt: 1 | 2 | 3;
  // Repris depuis le metadata du dernier event order_revival_refund_failed
  // posé par handle-payment-succeeded. Sert à poser cancellation_reason
  // côté UPDATE order au succès du retry.
  blockedReason: "blocked_stock" | "blocked_slot";
  consumerId: string | null;
  admin: SupabaseClient;
};

const MAX_ATTEMPTS = 3;

export async function retryFailedRefund(
  params: RetryRefundParams,
): Promise<RetryRefundResult> {
  const {
    orderId,
    paymentIntentId,
    attempt,
    blockedReason,
    consumerId,
    admin,
  } = params;

  const idempotencyKey = `refund_${orderId}_${attempt}`;

  try {
    const refund = await stripe.refunds.create(
      { payment_intent: paymentIntentId },
      { idempotencyKey },
    );

    // UPDATE cancellation_reason (statut reste cancelled, cancelled_at reste
    // figé). Symétrique au path nominal handle-payment-succeeded.ts:206-209.
    const cancellationReason: "revival_blocked_stock" | "revival_blocked_slot" =
      blockedReason === "blocked_stock"
        ? "revival_blocked_stock"
        : "revival_blocked_slot";

    const { error: updateError } = await admin
      .from("orders")
      .update({ cancellation_reason: cancellationReason })
      .eq("id", orderId);

    if (updateError) {
      // Drift : refund émis chez Stripe mais UPDATE DB a échoué. Préfixe
      // grep-able pour réconciliation manuelle (cohérent avec le pattern
      // [REFUND_DB_DRIFT] des autres refund paths).
      console.warn(
        `[REFUND_RETRY_DB_DRIFT] order=${orderId} pi=${paymentIntentId} attempt=${attempt} refund_id=${refund.id} ${updateError.message}`,
      );
    }

    await logPaymentEvent({
      eventType: "order_refund_retried_succeeded",
      userId: consumerId,
      metadata: {
        order_id: orderId,
        payment_intent_id: paymentIntentId,
        attempt,
        refund_id: refund.id,
        blocked_reason: blockedReason,
      },
    });

    console.log(
      `[REFUND_RETRY_SUCCESS] order=${orderId} pi=${paymentIntentId} attempt=${attempt} refund_id=${refund.id}`,
    );

    return "succeeded";
  } catch (refundErr) {
    const errorMessage = (refundErr as Error).message;

    // Re-pose un audit log refund_failed pour incrémenter le compteur
    // (cron caller comptera ces events pour déterminer le prochain attempt).
    await logPaymentEvent({
      eventType: "order_revival_refund_failed",
      userId: consumerId,
      metadata: {
        order_id: orderId,
        payment_intent_id: paymentIntentId,
        attempt,
        retry_error: errorMessage,
        blocked_reason: blockedReason,
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
          attempts_total: MAX_ATTEMPTS,
          last_error: errorMessage,
          blocked_reason: blockedReason,
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
          attempts_total: MAX_ATTEMPTS,
          last_error: errorMessage,
          blocked_reason: blockedReason,
        },
      });

      if (notifError) {
        console.warn(
          `[REFUND_RETRY_NOTIF_WARN] order=${orderId} pi=${paymentIntentId} ${notifError.message}`,
        );
      }

      console.error(
        `[REFUND_RETRY_EXHAUSTED] order=${orderId} pi=${paymentIntentId} attempts=${MAX_ATTEMPTS} last_error=${errorMessage}`,
      );

      return "failed_exhausted";
    }

    console.warn(
      `[REFUND_RETRY_FAILED] order=${orderId} pi=${paymentIntentId} attempt=${attempt} error=${errorMessage}`,
    );

    return "failed_will_retry";
  }
}
