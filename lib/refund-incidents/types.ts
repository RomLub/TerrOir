/**
 * Source-of-truth TypeScript des types refund_incidents et
 * refund_incident_attempts (T-102.1).
 *
 * Maintenu manuellement (pas de database.types.ts généré dans
 * le repo, cf. T-102.1 inspection §3).
 *
 * Toute modification ici DOIT être synchronisée avec la migration
 * SQL correspondante (CHECK constraints). Le test
 * tests/lib/refund-incidents/types.test.ts vérifie l'égalité des
 * valeurs entre cet enum TS et la migration DDL — toute drift fait
 * échouer la suite.
 */

export const REFUND_KINDS = ["revival", "admin", "timeout"] as const;
export type RefundKind = (typeof REFUND_KINDS)[number];

export const REFUND_INCIDENT_STATUSES = [
  "pending",
  "retrying",
  "succeeded",
  "exhausted",
  "manually_resolved",
  "aborted",
] as const;
export type RefundIncidentStatus = (typeof REFUND_INCIDENT_STATUSES)[number];

export const REFUND_ATTEMPT_OUTCOMES = ["failed", "succeeded"] as const;
export type RefundAttemptOutcome = (typeof REFUND_ATTEMPT_OUTCOMES)[number];

export type RefundIncident = {
  id: string;
  order_id: string;
  kind: RefundKind;
  payment_intent_id: string;
  consumer_id: string | null;
  status: RefundIncidentStatus;
  retry_count: number;
  max_retries: number;
  last_error_code: string | null;
  last_error_message: string | null;
  blocked_reason: string | null;
  resolution_note: string | null;
  first_failed_event_at: string; // ISO timestamptz
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type RefundIncidentAttempt = {
  id: string;
  refund_incident_id: string;
  attempt_number: number;
  outcome: RefundAttemptOutcome;
  stripe_error_code: string | null;
  stripe_error_type: string | null;
  stripe_error_message: string | null;
  stripe_request_id: string | null;
  stripe_refund_id: string | null;
  attempted_at: string;
};
