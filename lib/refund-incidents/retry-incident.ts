import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe/server";
import { classifyRefundError } from "@/lib/refund-incidents/classify-error";
import { recordRefundAttempt } from "@/lib/refund-incidents/record-refund-attempt";
import type { RefundKind } from "@/lib/refund-incidents/types";

/**
 * Helper retry T-102.2.c : tente un refund Stripe sur un refund_incidents
 * existant (status='pending'|'retrying') et délègue la persistance à la RPC
 * record_refund_attempt (T-102.2.b) pour incrémenter retry_count + status.
 *
 * Caller : app/api/cron/retry-failed-refunds/route.ts (cron daily 0 4 * * *).
 * Le cron query refund_incidents directement (T-102.2.c bascule depuis l'ancien
 * modèle audit_logs-driven vers refund_incidents source-of-truth).
 *
 * Politique retry (validée orchestrateur Q4) :
 *   - Daily simple : 1 attempt par run, max 3 attempts cumulatifs.
 *   - Backoff implicite ~24h entre runs cron (cas exceptionnel, suffisant).
 *   - Pas de colonne last_attempt_at (pas de modif schéma en T-102.2.c).
 *   - Au 3e échec → status='exhausted' (posé par RPC) + INSERT notification
 *     placeholder (template='refund_retry_exhausted', T-102.3 ajoutera Resend).
 *
 * Court-circuit permanent (Q4 T-102.2.b déjà en place côté RPC) :
 *   - Si Stripe retourne une erreur classifiée 'permanent' (charge_already_refunded,
 *     account_closed, balance_insufficient, …), record_refund_attempt passe
 *     status='exhausted' direct sans attendre max_retries. Le helper retry
 *     retourne 'failed_permanent_short_circuit' pour log différencié.
 *
 * Idempotency Stripe (CRITIQUE) :
 *   idempotencyKey = `refund_${orderId}_${kind}_${attempt_number}`.
 *   Empêche double refund si :
 *     - le cron run déclenche 2 fois (timeout Vercel, retry serverless),
 *     - le même attempt est rejoué (race R1 tolérée — la 2e RPC pète sur
 *       UNIQUE(refund_incident_id, attempt_number), helper fail-safe absorbe).
 *
 * UPDATE orders.closure_reason sur succès retry (Q3) :
 *   Conservé UNIQUEMENT pour kind='revival' (poser revival_blocked_stock|slot
 *   selon blockedReason). Pour kind='admin'|'timeout', closure_reason a déjà
 *   été posée au 1er succès du path d'origine ou au 1er échec côté UPDATE
 *   path B/C (cf. T-102.2.b §7). Pour 'revival', le path nominal n'écrit
 *   closure_reason QUE sur succès du refund initial → si on retente, c'est
 *   ici qu'on doit la poser pour que les dashboards UI consumer/producer
 *   reflètent l'état correct.
 *
 *   Fail-safe DB drift (R3) : si l'UPDATE Postgres rate (RLS, lock contention,
 *   table down), on log [REFUND_RETRY_DB_DRIFT] grep-able mais on NE re-throw
 *   PAS. Stripe a déjà refundé — on ne re-tente surtout pas à cause d'un
 *   UPDATE DB raté (sinon double refund irrécupérable au prochain run).
 *   ⚠️ NE PAS NETTOYER ce comportement : c'est volontaire.
 *
 * Race tolérance (R1) :
 *   recordRefundAttempt est lui-même fail-safe (cf. lib/refund-incidents/
 *   record-refund-attempt.ts). Si la RPC retourne null (UNIQUE violation,
 *   table down, etc.), le helper retry retourne 'failed_will_retry' par
 *   défaut prudent — le prochain run cron retentera (status n'a pas bougé).
 *
 * Logs greppables Vercel :
 *   - [REFUND_RETRY_SUCCESS]            : refund réussi
 *   - [REFUND_RETRY_DB_DRIFT]           : UPDATE closure_reason raté post-success
 *   - [REFUND_RETRY_FAILED]             : échec, will_retry au prochain run
 *   - [REFUND_RETRY_EXHAUSTED]          : 3e échec, status=exhausted
 *   - [REFUND_RETRY_PERMANENT]          : court-circuit permanent
 *   - [REFUND_RETRY_NOTIF_WARN]         : INSERT notification placeholder raté
 *   - [REFUND_RETRY_RECORD_WARN]        : recordRefundAttempt a renvoyé null
 *                                          (race ou RPC down) — helper fail-safe
 */

export type RetryIncidentParams = {
  incidentId: string;
  orderId: string;
  kind: RefundKind;
  paymentIntentId: string;
  consumerId: string | null;
  blockedReason: "blocked_stock" | "blocked_slot" | null;
  /** retry_count actuel sur refund_incidents (pré-tentative). attempt_number = retryCount + 1. */
  retryCount: number;
  admin: SupabaseClient;
};

export type RetryIncidentResult =
  | "succeeded"
  | "failed_will_retry"
  | "failed_exhausted"
  | "failed_permanent_short_circuit";

export async function retryIncident(
  params: RetryIncidentParams,
): Promise<RetryIncidentResult> {
  const {
    incidentId,
    orderId,
    kind,
    paymentIntentId,
    consumerId,
    blockedReason,
    retryCount,
    admin,
  } = params;

  const attemptNumber = retryCount + 1;
  const idempotencyKey = `refund_${orderId}_${kind}_${attemptNumber}`;

  let refund: { id: string };
  try {
    refund = await stripe.refunds.create(
      { payment_intent: paymentIntentId },
      { idempotencyKey },
    );
  } catch (refundErr) {
    // Stripe a refusé. Classify + persiste l'attempt failed via RPC.
    const classified = classifyRefundError(refundErr);

    const recordResult = await recordRefundAttempt({
      orderId,
      kind,
      paymentIntentId,
      consumerId,
      blockedReason: blockedReason ?? null,
      outcome: "failed",
      classified,
    });

    if (!recordResult) {
      // Race R1 : la RPC a pété (UNIQUE violation 23505 ou autre). Helper
      // fail-safe absorbe ; on retourne failed_will_retry par défaut prudent
      // pour que le prochain run cron retente (status pas avancé en DB
      // depuis notre point de vue).
      console.warn(
        `[REFUND_RETRY_RECORD_WARN] order=${orderId} kind=${kind} pi=${paymentIntentId} attempt=${attemptNumber} incident=${incidentId} record returned null`,
      );
      return "failed_will_retry";
    }

    // La RPC a posé status='exhausted' soit par court-circuit permanent,
    // soit parce qu'on a atteint max_retries. Dans les 2 cas on déclenche
    // l'INSERT notification placeholder (T-102.3 lira cette table pour
    // envoyer un mail Resend admin).
    if (recordResult.incidentStatus === "exhausted") {
      const isPermanent = classified.category === "permanent";

      const { error: notifError } = await admin
        .from("notifications")
        .insert({
          user_id: null,
          type: "email",
          template: "refund_retry_exhausted",
          statut: "failed",
          metadata: {
            incident_id: incidentId,
            order_id: orderId,
            payment_intent_id: paymentIntentId,
            kind,
            attempt: attemptNumber,
            short_circuit: isPermanent,
            stripe_error_code: classified.code,
            stripe_error_message: classified.message,
            stripe_request_id: classified.requestId,
          },
        });

      if (notifError) {
        // Best-effort : si l'INSERT échoue (RLS, table down), on log mais
        // on continue. La row exhausted est déjà visible côté refund_incidents
        // (admin verra dans dashboard T-102.4).
        console.warn(
          `[REFUND_RETRY_NOTIF_WARN] order=${orderId} kind=${kind} pi=${paymentIntentId} incident=${incidentId} ${notifError.message}`,
        );
      }

      if (isPermanent) {
        console.error(
          `[REFUND_RETRY_PERMANENT] order=${orderId} kind=${kind} pi=${paymentIntentId} attempt=${attemptNumber} incident=${incidentId} code=${classified.code ?? "null"}`,
        );
        return "failed_permanent_short_circuit";
      }

      console.error(
        `[REFUND_RETRY_EXHAUSTED] order=${orderId} kind=${kind} pi=${paymentIntentId} attempts=${attemptNumber} incident=${incidentId} last_error=${classified.message}`,
      );
      return "failed_exhausted";
    }

    // Status devenu pending → retrying (ou inchangé si déjà retrying).
    // Le prochain run cron retentera.
    console.warn(
      `[REFUND_RETRY_FAILED] order=${orderId} kind=${kind} pi=${paymentIntentId} attempt=${attemptNumber} incident=${incidentId} error=${classified.message}`,
    );
    return "failed_will_retry";
  }

  // ── Succès Stripe ─────────────────────────────────────────────────────
  // Persiste l'attempt 'succeeded' via RPC : record_refund_attempt passera
  // refund_incidents.status='succeeded' + resolved_at=now() + insert
  // refund_incident_attempts avec attempt_number = retry_count + 1.
  await recordRefundAttempt({
    orderId,
    kind,
    paymentIntentId,
    consumerId,
    blockedReason: blockedReason ?? null,
    outcome: "succeeded",
    classified: null,
    stripeRefundId: refund.id,
  });

  // Q3 : UPDATE closure_reason sur succès retry UNIQUEMENT pour kind='revival'.
  // Les paths admin/timeout ont déjà posé closure_reason au moment de leur
  // 1er passage (cf. T-102.2.b §7). Pour revival, le path nominal n'écrit
  // closure_reason QUE sur succès Stripe initial → si on retente, c'est ici
  // qu'on la pose pour cohérence dashboards UI.
  //
  // ⚠️ R3 fail-safe DB drift : si l'UPDATE rate, log [REFUND_RETRY_DB_DRIFT]
  // mais NE PAS re-throw — Stripe a déjà refundé, surtout pas re-tenter.
  // NE PAS NETTOYER ce try/catch (volontaire).
  if (kind === "revival") {
    const closureReason =
      blockedReason === "blocked_stock"
        ? "revival_blocked_stock"
        : "revival_blocked_slot";

    try {
      const { error: updateError } = await admin
        .from("orders")
        .update({ closure_reason: closureReason })
        .eq("id", orderId);

      if (updateError) {
        console.warn(
          `[REFUND_RETRY_DB_DRIFT] order=${orderId} kind=revival pi=${paymentIntentId} attempt=${attemptNumber} refund_id=${refund.id} ${updateError.message}`,
        );
      }
    } catch (updateException) {
      console.warn(
        `[REFUND_RETRY_DB_DRIFT] order=${orderId} kind=revival pi=${paymentIntentId} attempt=${attemptNumber} refund_id=${refund.id} exception=${(updateException as Error).message}`,
      );
    }
  }

  console.log(
    `[REFUND_RETRY_SUCCESS] order=${orderId} kind=${kind} pi=${paymentIntentId} attempt=${attemptNumber} incident=${incidentId} refund_id=${refund.id}`,
  );

  return "succeeded";
}
