import {
  AUTH_EVENT_TYPES,
  type AuthEventType,
} from "@/lib/audit-logs/log-auth-event";
import {
  PAYMENT_EVENT_TYPES,
  type PaymentEventType,
} from "@/lib/audit-logs/log-payment-event";
import {
  REVIEW_EVENT_TYPES,
  type ReviewEventType,
} from "@/lib/audit-logs/log-review-event";
import {
  LEGAL_COMPLIANCE_EVENT_TYPES,
  type LegalComplianceEventType,
} from "@/lib/audit-logs/log-legal-event";
import {
  CATEGORISATION_EVENT_TYPES,
  type CategorisationEventType,
} from "@/lib/audit-logs/log-categorisation-event";
import {
  PICKUP_EVENT_TYPES,
  type PickupEventType,
} from "@/lib/audit-logs/log-pickup-event";
import {
  REVIEW_FOLLOWUP_EVENT_TYPES,
  type ReviewFollowupEventType,
} from "@/lib/audit-logs/log-review-followup-event";
import {
  REFUND_INCIDENTS_EVENT_TYPES,
  type RefundIncidentsEventType,
} from "@/lib/audit-logs/log-refund-incidents-event";
import {
  REVIEW_MODERATION_EVENT_TYPES,
  type ReviewModerationEventType,
} from "@/lib/audit-logs/log-review-moderation-event";
import {
  PRODUCERS_ADMIN_EVENT_TYPES,
  type ProducersAdminEventType,
} from "@/lib/audit-logs/log-producers-admin-event";
import {
  PRODUCER_INTERESTS_EVENT_TYPES,
  type ProducerInterestsEventType,
} from "@/lib/audit-logs/log-producer-interests-event";

// Source unique consolidée pour la page admin /audit-logs : concaténation
// des clusters helpers sans duplication. L'ordre suit l'ordre d'apparition
// historique (Auth d'abord, Payment, puis Review et Legal). Nouveau cluster
// = ajouter ici + dans labels.ts + couvert auto par categorize-event-type.
export const ALL_EVENT_TYPES = [
  ...AUTH_EVENT_TYPES,
  ...PAYMENT_EVENT_TYPES,
  ...REVIEW_EVENT_TYPES,
  ...LEGAL_COMPLIANCE_EVENT_TYPES,
  ...CATEGORISATION_EVENT_TYPES,
  ...PICKUP_EVENT_TYPES,
  ...REVIEW_FOLLOWUP_EVENT_TYPES,
  ...REFUND_INCIDENTS_EVENT_TYPES,
  ...REVIEW_MODERATION_EVENT_TYPES,
  ...PRODUCERS_ADMIN_EVENT_TYPES,
  ...PRODUCER_INTERESTS_EVENT_TYPES,
] as const;

export type AuditEventType =
  | AuthEventType
  | PaymentEventType
  | ReviewEventType
  | LegalComplianceEventType
  | CategorisationEventType
  | PickupEventType
  | ReviewFollowupEventType
  | RefundIncidentsEventType
  | ReviewModerationEventType
  | ProducersAdminEventType
  | ProducerInterestsEventType;
