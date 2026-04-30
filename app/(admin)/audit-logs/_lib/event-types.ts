import {
  AUTH_EVENT_TYPES,
  type AuthEventType,
} from "@/lib/audit-logs/log-auth-event";
import {
  PAYMENT_EVENT_TYPES,
  type PaymentEventType,
} from "@/lib/audit-logs/log-payment-event";

// Source unique consolidée pour la page admin /audit-logs : concaténation
// des deux listes sans duplication. L'ordre suit l'ordre de déclaration
// dans les helpers (Auth d'abord, puis Payment) — cohérent avec l'ordre
// d'apparition dans le journal.
export const ALL_EVENT_TYPES = [
  ...AUTH_EVENT_TYPES,
  ...PAYMENT_EVENT_TYPES,
] as const;

export type AuditEventType = AuthEventType | PaymentEventType;
