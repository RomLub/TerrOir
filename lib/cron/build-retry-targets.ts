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
// T-412 : extension aux 3 paths refund retry-able. RefundKind discrimine
// les events par origine (revival / admin / timeout) pour permettre des
// keys idempotency Stripe distinctes par path. Group key = (orderId, kind)
// composite : si une order a échoué historiquement via 2 paths différents
// (rare mais possible), on traite chaque kind comme target distincte.
// Convention nommage alignée avec TA Bundle 1 T-408 (`${context}` initial)
// — `kind === context ∈ { revival, admin, timeout }` côté retry.
//
// Convention attempt (par kind) :
//   - count(refund_failed)=1 → attempt=1 (1er retry, le webhook initial = signal de départ)
//   - count(refund_failed)=2 → attempt=2 (1er retry a échoué, on retente)
//   - count(refund_failed)=3 → attempt=3 (dernier retry possible)
//   - count(refund_failed)≥4 sans exhausted → audit incohérent → skip défensif

export type RefundKind = "revival" | "admin" | "timeout";

export type AuditLogRow = {
  event_type: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type RetryTarget = {
  orderId: string;
  paymentIntentId: string;
  kind: RefundKind;
  // blockedReason renseigné uniquement pour kind='revival' (path résurrection
  // bloquée). Les paths admin/timeout n'ont pas de blocked_reason metadata.
  blockedReason?: "blocked_stock" | "blocked_slot";
  attempt: 1 | 2 | 3;
};

export type SkippedTarget = {
  order_id: string;
  kind: RefundKind;
  attempt: number;
  result: "skipped_invalid_metadata";
  error: string;
};

const FAILED_EVENTS: ReadonlyArray<string> = [
  "order_revival_refund_failed",
  "order_admin_refund_failed",
  "order_timeout_refund_failed",
];

const RESOLVED_EVENTS: ReadonlyArray<string> = [
  "order_refund_retried_succeeded",
  "order_refund_retry_exhausted",
];

/**
 * Map event_type vers RefundKind. Rétrocompat : events legacy
 * `order_revival_refund_failed` antérieurs à T-412 n'ont pas
 * `metadata.kind` posé — défaut sur 'revival' via le préfixe event_type.
 *
 * Pour les events `order_refund_retried_succeeded` et `_exhausted`,
 * `metadata.kind` doit être posé par `retryFailedRefund` (T-412). Si
 * absent (legacy), fallback sur 'revival' (cas historique pre-T-412).
 */
function eventTypeToKind(
  eventType: string,
  metadataKind?: unknown,
): RefundKind {
  if (
    metadataKind === "revival" ||
    metadataKind === "admin" ||
    metadataKind === "timeout"
  ) {
    return metadataKind;
  }
  if (eventType === "order_admin_refund_failed") return "admin";
  if (eventType === "order_timeout_refund_failed") return "timeout";
  // Default : revival (couvre order_revival_refund_failed +
  // resolved events legacy sans metadata.kind).
  return "revival";
}

export function buildRetryTargets(events: AuditLogRow[]): {
  targets: RetryTarget[];
  skipped: SkippedTarget[];
} {
  // Group events par clé composite (orderId, kind). Events sans order_id
  // en metadata sont ignorés silencieusement (ne devrait pas arriver, mais
  // défensif côté query JSONB).
  type Key = string; // `${orderId}::${kind}`
  const byOrderKind = new Map<Key, { orderId: string; kind: RefundKind; events: AuditLogRow[] }>();

  for (const evt of events) {
    const orderId =
      typeof evt.metadata?.order_id === "string"
        ? evt.metadata.order_id
        : null;
    if (!orderId) continue;

    const kind = eventTypeToKind(evt.event_type, evt.metadata?.kind);
    const key = `${orderId}::${kind}`;
    const existing = byOrderKind.get(key);
    if (existing) {
      existing.events.push(evt);
    } else {
      byOrderKind.set(key, { orderId, kind, events: [evt] });
    }
  }

  const targets: RetryTarget[] = [];
  const skipped: SkippedTarget[] = [];

  for (const [, group] of byOrderKind) {
    const { orderId, kind, events: orderEvents } = group;

    // Sortie de boucle : déjà résolu ou abandonné (par kind).
    const hasResolved = orderEvents.some((e) =>
      RESOLVED_EVENTS.includes(e.event_type),
    );
    if (hasResolved) continue;

    const failedCount = orderEvents.filter((e) =>
      FAILED_EVENTS.includes(e.event_type),
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
        kind,
        attempt: failedCount,
        result: "skipped_invalid_metadata",
        error: `unexpected failed_count=${failedCount} without exhausted event`,
      });
      console.warn(
        `[CRON_RETRY_REFUND_INCONSISTENT] order=${orderId} kind=${kind} failed_count=${failedCount} expected exhausted event`,
      );
      continue;
    }

    const nextAttempt = failedCount as 1 | 2 | 3;

    // Dernier event refund_failed (le plus récent) pour récupérer
    // payment_intent_id + blocked_reason si applicable.
    const lastFailed = orderEvents
      .filter((e) => FAILED_EVENTS.includes(e.event_type))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

    if (!lastFailed) continue;

    const paymentIntentId =
      typeof lastFailed.metadata?.payment_intent_id === "string"
        ? lastFailed.metadata.payment_intent_id
        : null;

    if (!paymentIntentId) {
      skipped.push({
        order_id: orderId,
        kind,
        attempt: nextAttempt,
        result: "skipped_invalid_metadata",
        error: `missing payment_intent_id in audit log metadata`,
      });
      console.warn(
        `[CRON_RETRY_REFUND_BAD_META] order=${orderId} kind=${kind} pi=null`,
      );
      continue;
    }

    // blocked_reason requis uniquement pour kind='revival' (cancellation_reason
    // côté UPDATE order au succès retry). Pour admin/timeout, optionnel.
    let blockedReason: "blocked_stock" | "blocked_slot" | undefined;
    if (kind === "revival") {
      const rawBlocked = lastFailed.metadata?.blocked_reason;
      if (rawBlocked !== "blocked_stock" && rawBlocked !== "blocked_slot") {
        skipped.push({
          order_id: orderId,
          kind,
          attempt: nextAttempt,
          result: "skipped_invalid_metadata",
          error: `missing blocked_reason in revival audit log metadata`,
        });
        console.warn(
          `[CRON_RETRY_REFUND_BAD_META] order=${orderId} kind=revival blocked=${String(rawBlocked ?? "null")}`,
        );
        continue;
      }
      blockedReason = rawBlocked;
    }

    targets.push({
      orderId,
      paymentIntentId,
      kind,
      blockedReason,
      attempt: nextAttempt,
    });
  }

  return { targets, skipped };
}
