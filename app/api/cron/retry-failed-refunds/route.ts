import { NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/cron/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  retryFailedRefund,
  type RetryRefundResult,
} from "@/lib/stripe/retry-failed-refund";
import {
  buildRetryTargets,
  type AuditLogRow,
} from "@/lib/cron/build-retry-targets";

// Cron daily Vercel `0 4 * * *` (4h UTC, soit 5-6h Paris hors heures de
// pointe). Tente de re-rembourser les orders dont le refund initial du
// path résurrection bloquée a échoué (cf. `handle-payment-succeeded.ts:241`,
// audit log `order_revival_refund_failed`).
//
// Pattern audit-log-driven background job : audit_logs est la single source
// of truth. Pas de migration DB ni de table dédiée — extension TS pure +
// query metadata JSONB. Cohérent avec le scope minimal validé 28/04 (cf.
// décisions retry-failed-refunds session — backoff daily simple, scope
// résurrection bloquée uniquement).
//
// Algorithme :
//   1. SELECT audit_logs des 3 event_types pertinents (refund_failed +
//      retried_succeeded + retry_exhausted), ordre desc, limit 1000.
//   2. buildRetryTargets() : group by order_id, dédup par état résolu,
//      compute attempt number depuis count(refund_failed).
//   3. SELECT orders.consumer_id en batch (.in()) pour un audit log avec
//      userId correct (null toléré sur RGPD-deleted orders).
//   4. Pour chaque target : retryFailedRefund(...) → résultat capturé
//      dans le JSON de retour.
//
// Auth : header `Authorization: Bearer ${CRON_SECRET}` via assertCronAuth
// (pattern réutilisé sur les 6 crons existants).
//
// Note Next.js 14 : la pure function `buildRetryTargets` est extraite dans
// `lib/cron/build-retry-targets.ts` car les route files Next 14 n'autorisent
// que les exports HTTP handlers + config props.

type ProcessedResult = {
  order_id: string;
  attempt: number;
  result: RetryRefundResult | "skipped_invalid_metadata";
  error?: string;
};

export async function POST(request: Request) {
  const authError = assertCronAuth(request);
  if (authError) return authError;

  const admin = createSupabaseAdminClient();

  // Limite 1000 events suffisante : volume cumulé attendu très faible
  // (cas exceptionnel = refund Stripe échoué sur path résurrection bloquée
  // = lui-même rare). À monitorer en prod : si on tape la limite, c'est
  // un signal d'incident plus large.
  const { data: events, error } = await admin
    .from("audit_logs")
    .select("event_type, metadata, created_at")
    .in("event_type", [
      "order_revival_refund_failed",
      "order_refund_retried_succeeded",
      "order_refund_retry_exhausted",
    ])
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const eventRows = (events ?? []) as AuditLogRow[];
  const { targets, skipped } = buildRetryTargets(eventRows);

  if (targets.length === 0 && skipped.length === 0) {
    return NextResponse.json({ processed: 0, results: [] });
  }

  // Récupère consumer_id pour chaque target en une query batch (évite N
  // SELECT en boucle). Les orders disparues (RGPD) verront consumer_id null
  // dans le map → audit log poussé avec userId=null (comportement défensif
  // existant côté logPaymentEvent, cf. log-payment-event.ts:46-48).
  const orderIds = targets.map((t) => t.orderId);
  const consumerByOrderId = new Map<string, string | null>();

  if (orderIds.length > 0) {
    const { data: orders } = await admin
      .from("orders")
      .select("id, consumer_id")
      .in("id", orderIds);
    for (const o of orders ?? []) {
      consumerByOrderId.set(
        o.id as string,
        (o.consumer_id as string | null) ?? null,
      );
    }
  }

  const results: ProcessedResult[] = [...skipped];

  for (const target of targets) {
    const consumerId = consumerByOrderId.get(target.orderId) ?? null;
    const result = await retryFailedRefund({
      orderId: target.orderId,
      paymentIntentId: target.paymentIntentId,
      attempt: target.attempt,
      blockedReason: target.blockedReason,
      consumerId,
      admin,
    });
    results.push({
      order_id: target.orderId,
      attempt: target.attempt,
      result,
    });
  }

  return NextResponse.json({ processed: results.length, results });
}

export const GET = POST;
