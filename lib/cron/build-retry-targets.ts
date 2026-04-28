// Pure function extraite de la route cron `/api/cron/retry-failed-refunds`
// pour respecter la contrainte Next.js 14 : un route file ne peut exporter
// que des HTTP method handlers + config props. `buildTargets` reste donc
// hors du module route, importée par la route et testable isolément.
//
// Logique : étant donné un batch de events audit_logs liés au cycle retry
// (refund_failed, retried_succeeded, retry_exhausted), retourne :
//   - `targets` : orders éligibles à un retry au prochain run cron, avec
//     attempt number calculé via le compteur `count(refund_failed)` côté JS.
//   - `skipped` : orders ignorés pour metadata invalide ou état audit
//     incohérent (≥4 refund_failed sans exhausted), retournés tels quels
//     dans le JSON de la route pour traçabilité ops.
//
// Convention attempt :
//   - count(refund_failed)=1 → attempt=1 (1er retry, le webhook initial = signal de départ)
//   - count(refund_failed)=2 → attempt=2 (1er retry a échoué, on retente)
//   - count(refund_failed)=3 → attempt=3 (dernier retry possible)
//   - count(refund_failed)≥4 sans exhausted → audit incohérent → skip défensif

export type AuditLogRow = {
  event_type: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type RetryTarget = {
  orderId: string;
  paymentIntentId: string;
  blockedReason: "blocked_stock" | "blocked_slot";
  attempt: 1 | 2 | 3;
};

export type SkippedTarget = {
  order_id: string;
  attempt: number;
  result: "skipped_invalid_metadata";
  error: string;
};

export function buildRetryTargets(events: AuditLogRow[]): {
  targets: RetryTarget[];
  skipped: SkippedTarget[];
} {
  // Group events par order_id (depuis metadata.order_id). Events sans
  // order_id en metadata sont ignorés silencieusement (ne devrait pas
  // arriver, mais défensif côté query JSONB).
  const byOrder = new Map<string, AuditLogRow[]>();
  for (const evt of events) {
    const orderId =
      typeof evt.metadata?.order_id === "string"
        ? evt.metadata.order_id
        : null;
    if (!orderId) continue;
    const existing = byOrder.get(orderId) ?? [];
    existing.push(evt);
    byOrder.set(orderId, existing);
  }

  const targets: RetryTarget[] = [];
  const skipped: SkippedTarget[] = [];

  for (const [orderId, orderEvents] of byOrder) {
    // Sortie de boucle : déjà résolu ou abandonné.
    const hasResolved = orderEvents.some(
      (e) =>
        e.event_type === "order_refund_retried_succeeded" ||
        e.event_type === "order_refund_retry_exhausted",
    );
    if (hasResolved) continue;

    const failedCount = orderEvents.filter(
      (e) => e.event_type === "order_revival_refund_failed",
    ).length;

    if (failedCount === 0) {
      // Cas patho : sélectionné mais pas d'event failed. Ne devrait pas
      // arriver vu la query.
      continue;
    }

    if (failedCount >= 4) {
      // Défensif : 3 retries cron auraient dû poser exhausted. Si on
      // arrive ici, audit_logs est dans un état incohérent → skip + log.
      skipped.push({
        order_id: orderId,
        attempt: failedCount,
        result: "skipped_invalid_metadata",
        error: `unexpected failed_count=${failedCount} without exhausted event`,
      });
      console.warn(
        `[CRON_RETRY_REFUND_INCONSISTENT] order=${orderId} failed_count=${failedCount} expected exhausted event`,
      );
      continue;
    }

    const nextAttempt = failedCount as 1 | 2 | 3;

    // Dernier event refund_failed (le plus récent) pour récupérer
    // payment_intent_id + blocked_reason.
    const lastFailed = orderEvents
      .filter((e) => e.event_type === "order_revival_refund_failed")
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

    if (!lastFailed) continue;

    const paymentIntentId =
      typeof lastFailed.metadata?.payment_intent_id === "string"
        ? lastFailed.metadata.payment_intent_id
        : null;
    const rawBlocked = lastFailed.metadata?.blocked_reason;
    const blockedReason: "blocked_stock" | "blocked_slot" | null =
      rawBlocked === "blocked_stock" || rawBlocked === "blocked_slot"
        ? rawBlocked
        : null;

    if (!paymentIntentId || !blockedReason) {
      skipped.push({
        order_id: orderId,
        attempt: nextAttempt,
        result: "skipped_invalid_metadata",
        error: `missing payment_intent_id or blocked_reason in audit log metadata`,
      });
      console.warn(
        `[CRON_RETRY_REFUND_BAD_META] order=${orderId} pi=${paymentIntentId ?? "null"} blocked=${rawBlocked ?? "null"}`,
      );
      continue;
    }

    targets.push({
      orderId,
      paymentIntentId,
      blockedReason,
      attempt: nextAttempt,
    });
  }

  return { targets, skipped };
}
