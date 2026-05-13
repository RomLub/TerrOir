// Types partagés pour la surface admin /refund-incidents (PR3
// feature/admin-new-surfaces). Cluster READ + WRITE admin sur la table
// `refund_incidents` (et jointure 1:1 `orders` pour le code commande et
// le montant total).
//
// Source schéma : migration T-102 (création `refund_incidents` +
// `refund_incident_attempts` côté flow refund Stripe avec backoff retry).
// CHECK constraint sur status :
//   pending | retrying | succeeded | exhausted | manually_resolved | aborted
// CHECK constraint sur kind :
//   revival | admin | timeout | manual_cancel

export const REFUND_INCIDENT_STATUS_VALUES = [
  "pending",
  "retrying",
  "succeeded",
  "exhausted",
  "manually_resolved",
  "aborted",
] as const;

export type RefundIncidentStatus =
  (typeof REFUND_INCIDENT_STATUS_VALUES)[number];

// Tab "all" agrège tous les statuts. Cohérent pattern producers (cf.
// GestionProducteursClient).
export const REFUND_INCIDENT_STATUS_FILTERS = [
  "pending",
  "retrying",
  "failed", // alias UI : couvre exhausted + aborted (incidents bloqués)
  "resolved", // alias UI : couvre succeeded (auto)
  "resolved_manually", // alias UI : couvre manually_resolved (admin)
  "all",
] as const;

export type RefundIncidentStatusFilter =
  (typeof REFUND_INCIDENT_STATUS_FILTERS)[number];

export const REFUND_INCIDENT_KIND_VALUES = [
  "revival",
  "admin",
  "timeout",
  "manual_cancel",
] as const;

export type RefundIncidentKind =
  (typeof REFUND_INCIDENT_KIND_VALUES)[number];

// Statuts actionnables (UPDATE résolution manuelle autorisé). Une fois
// l'incident en `succeeded` (auto par retry), `exhausted` (épuisement
// retries — historique préservé), `manually_resolved` (déjà fait), ou
// `aborted` (annulé par cron/system), l'admin ne peut plus le rouvrir
// par cette surface.
export const REFUND_INCIDENT_ACTIONABLE_STATUSES: ReadonlyArray<RefundIncidentStatus> = [
  "pending",
  "retrying",
];

export function isRefundIncidentActionable(
  status: RefundIncidentStatus,
): boolean {
  return (REFUND_INCIDENT_ACTIONABLE_STATUSES as ReadonlyArray<string>).includes(
    status,
  );
}

// Row aplatie après jointure orders.code_commande / orders.montant_total.
// Tous les champs présentés à l'UI admin. Montant en cents (int) côté
// metadata pour cohérence audit log forensique ; affichage UI en euros.
export type AdminRefundIncidentRow = {
  id: string;
  orderId: string;
  orderCode: string | null;
  amountCents: number;
  kind: RefundIncidentKind;
  status: RefundIncidentStatus;
  retryCount: number;
  maxRetries: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  firstFailedEventAt: string;
  createdAt: string;
  resolvedAt: string | null;
};

// Row détaillée pour la page /refund-incidents/[id] — embarque les
// champs supplémentaires (payment_intent_id, blocked_reason,
// resolution_note, consumer_id) utiles à l'investigation forensique.
export type AdminRefundIncidentDetail = AdminRefundIncidentRow & {
  paymentIntentId: string;
  consumerId: string | null;
  blockedReason: string | null;
  resolutionNote: string | null;
  updatedAt: string;
};

// Une tentative de refund (row `refund_incident_attempts`). Tri par
// attempted_at ASC (chronologique) côté UI détail.
export type AdminRefundIncidentAttempt = {
  id: string;
  attemptNumber: number;
  outcome: string;
  stripeErrorCode: string | null;
  stripeErrorType: string | null;
  stripeErrorMessage: string | null;
  stripeRequestId: string | null;
  stripeRefundId: string | null;
  attemptedAt: string;
};

// Labels FR pour les statuts (UI Badge + Header). Source : audit
// terminologie produit utilisée dans le checkout flow + PR2 dashboard
// (KPI refund incidents).
export const REFUND_INCIDENT_STATUS_LABELS: Record<
  RefundIncidentStatus,
  string
> = {
  pending: "En attente",
  retrying: "Retry en cours",
  succeeded: "Résolu (auto)",
  exhausted: "Épuisé (échec)",
  manually_resolved: "Résolu manuellement",
  aborted: "Annulé",
};

export const REFUND_INCIDENT_KIND_LABELS: Record<RefundIncidentKind, string> = {
  revival: "Résurrection commande",
  admin: "Refund admin",
  timeout: "Timeout (auto)",
  manual_cancel: "Annulation manuelle",
};

export function getRefundIncidentStatusLabel(
  status: RefundIncidentStatus,
): string {
  return REFUND_INCIDENT_STATUS_LABELS[status] ?? status;
}

export function getRefundIncidentKindLabel(kind: RefundIncidentKind): string {
  return REFUND_INCIDENT_KIND_LABELS[kind] ?? kind;
}
