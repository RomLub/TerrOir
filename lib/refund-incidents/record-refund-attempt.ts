import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ClassifiedRefundError } from "@/lib/refund-incidents/classify-error";
import type { RefundKind } from "@/lib/refund-incidents/types";

/**
 * Helper fail-safe T-102.2.b : enregistre une tentative de refund Stripe
 * (échec ou succès) dans refund_incidents + refund_incident_attempts via
 * RPC atomique public.record_refund_attempt (cf. migration
 * 20260502064800_t102_2b_record_refund_attempt_rpc.sql).
 *
 * Pattern fail-safe identique à logPaymentEvent (lib/audit-logs/log-payment-event.ts) :
 *   - try/catch interne, swallow toute erreur, console.warn jamais re-throw.
 *   - Retourne null en cas d'échec write — caller doit gérer null gracieusement.
 *   - logPaymentEvent reste appelée en parallèle par les 3 paths (décision
 *     T-102.1 « hybride » : audit_logs garde la traçabilité forensique
 *     RGPD/PCI, refund_incidents devient source-of-truth pour le cron retry).
 *
 * Consommateurs T-102.2.b (échecs uniquement) :
 *   - lib/stripe/handle-payment-succeeded.ts catch revival_refund_failed
 *   - app/api/stripe/refund/route.ts catch admin manuel
 *   - app/api/cron/order-timeout/route.tsx catch dans la boucle batch
 *
 * Consommateur T-102.2.c (à venir, échecs + succès) :
 *   - lib/stripe/retry-failed-refund.ts (helper retry du cron daily)
 *
 * Logs greppables Vercel (décision orchestrateur Q7) :
 *   - [REFUND_INCIDENT_RECORDED]            : write OK (succès ou échec non-permanent)
 *   - [REFUND_INCIDENT_PERMANENT_EXHAUST]   : court-circuit Q4 (échec + permanent
 *                                              au 1er coup → status=exhausted direct)
 *   - [REFUND_INCIDENT_INSERT_WARN]         : write KO, fail-safe swallow
 */

export type RefundAttemptOutcome = "failed" | "succeeded";

export type RecordRefundAttemptParams = {
  orderId: string;
  kind: RefundKind;
  paymentIntentId: string;
  consumerId: string | null;
  /** Pour kind='revival' uniquement (paths admin/timeout : null). */
  blockedReason?: "blocked_stock" | "blocked_slot" | null;
  outcome: RefundAttemptOutcome;
  /**
   * Résultat de classifyRefundError(refundErr). Null pour outcome='succeeded'
   * (pas d'erreur Stripe à classifier sur un succès).
   */
  classified?: ClassifiedRefundError | null;
  /** Posé pour outcome='succeeded' (id de la row Stripe Refund). */
  stripeRefundId?: string | null;
  /**
   * Timestamp du premier échec sur ce (order_id, kind). Posé au INSERT
   * initial de refund_incidents (NOT NULL côté DB). Ignoré côté UPDATE.
   * Defaut : now().
   */
  firstFailedEventAt?: Date;
};

export type RecordRefundAttemptResult = {
  incidentId: string;
  incidentStatus: string;
  attemptId: string;
  attemptNumber: number;
};

/** Shape brute de la row retournée par la RPC public.record_refund_attempt. */
type RpcRow = {
  incident_id: string;
  incident_status: string;
  attempt_id: string;
  attempt_number: number;
};

export async function recordRefundAttempt(
  params: RecordRefundAttemptParams,
): Promise<RecordRefundAttemptResult | null> {
  try {
    const admin = createSupabaseAdminClient();

    const firstFailedEventAt = params.firstFailedEventAt ?? new Date();
    const classification = params.classified?.category ?? null;

    const { data, error } = await admin.rpc("record_refund_attempt", {
      p_order_id: params.orderId,
      p_kind: params.kind,
      p_payment_intent_id: params.paymentIntentId,
      p_consumer_id: params.consumerId,
      p_blocked_reason: params.blockedReason ?? null,
      p_outcome: params.outcome,
      p_stripe_error_code: params.classified?.code ?? null,
      p_stripe_error_type: params.classified?.type ?? null,
      p_stripe_error_message: params.classified?.message ?? null,
      p_stripe_request_id: params.classified?.requestId ?? null,
      p_stripe_refund_id: params.stripeRefundId ?? null,
      p_classification: classification,
      p_first_failed_event_at: firstFailedEventAt.toISOString(),
    });

    if (error) {
      console.warn(
        `[REFUND_INCIDENT_INSERT_WARN] order=${params.orderId} kind=${params.kind} outcome=${params.outcome} error=${error.message}`,
      );
      return null;
    }

    const rows = (data ?? []) as RpcRow[];
    if (rows.length === 0) {
      console.warn(
        `[REFUND_INCIDENT_INSERT_WARN] order=${params.orderId} kind=${params.kind} no rows returned from RPC`,
      );
      return null;
    }

    const row = rows[0]!;

    if (params.outcome === "failed" && classification === "permanent") {
      console.warn(
        `[REFUND_INCIDENT_PERMANENT_EXHAUST] order=${params.orderId} kind=${params.kind} code=${params.classified?.code ?? "null"} incident=${row.incident_id}`,
      );
    } else {
      console.log(
        `[REFUND_INCIDENT_RECORDED] order=${params.orderId} kind=${params.kind} outcome=${params.outcome} incident=${row.incident_id} attempt=${row.attempt_number} status=${row.incident_status}`,
      );
    }

    return {
      incidentId: row.incident_id,
      incidentStatus: row.incident_status,
      attemptId: row.attempt_id,
      attemptNumber: row.attempt_number,
    };
  } catch (err) {
    console.warn(
      `[REFUND_INCIDENT_INSERT_WARN] order=${params.orderId} kind=${params.kind} exception=${(err as Error).message}`,
    );
    return null;
  }
}
