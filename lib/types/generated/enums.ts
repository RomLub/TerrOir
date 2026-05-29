// AUTO-GENERATED — DO NOT EDIT MANUALLY
// Run: pnpm codegen:enums
// Source: supabase/migrations/*.sql (CHECK constraints)
//
// Single source of truth pour les enums applicatifs : valeurs extraites
// directement des migrations SQL. Le code TS qui hardcode ces valeurs
// (Zod, UI radio, helpers) doit importer ici pour éviter la dérive
// TS↔SQL silencieuse. Cf. T-220.

// enum admin_privilege (source: create_type, last migration: 20260523140000_admin_privilege_suspension.sql)
export const ADMIN_PRIVILEGE_VALUES = ["super_admin", "standard"] as const;
export type AdminPrivilege = (typeof ADMIN_PRIVILEGE_VALUES)[number];

// enum pending_refund_status (source: create_type, last migration: 20260511004000_p0_sweep_f014_pending_refunds.sql)
export const PENDING_REFUND_STATUS_VALUES = ["pending", "approved", "denied", "expired"] as const;
export type PendingRefundStatus = (typeof PENDING_REFUND_STATUS_VALUES)[number];

// disputes.status (source: in, last migration: 20260429020000_disputes_table.sql)
export const DISPUTES_STATUS_VALUES = ["needs_response", "under_review", "won", "lost", "warning_closed", "warning_needs_response", "warning_under_review"] as const;
export type DisputesStatus = (typeof DISPUTES_STATUS_VALUES)[number];

// email_change_otp_codes.step (source: in, last migration: 20260430161902_t013_email_change_a3_schema.sql)
export const EMAIL_CHANGE_OTP_CODES_STEP_VALUES = ["current", "new"] as const;
export type EmailChangeOtpCodesStep = (typeof EMAIL_CHANGE_OTP_CODES_STEP_VALUES)[number];

// email_suppressions.reason (source: in, last migration: 20260505600000_audit_email_h3_m5_email_suppressions.sql)
export const EMAIL_SUPPRESSIONS_REASON_VALUES = ["hard_bounce", "complained", "soft_bounce_threshold", "soft_bounce_pending", "manual"] as const;
export type EmailSuppressionsReason = (typeof EMAIL_SUPPRESSIONS_REASON_VALUES)[number];

// gms_prices.filiere (source: in, last migration: 20260428000000_gms_prices.sql)
export const GMS_PRICES_FILIERE_VALUES = ["bovin", "porcin", "ovin"] as const;
export type GmsPricesFiliere = (typeof GMS_PRICES_FILIERE_VALUES)[number];

// inbound_emails.tag (source: in, last migration: 20260524120000_inbound_emails.sql)
export const INBOUND_EMAILS_TAG_VALUES = ["producteur", "consommateur", "public"] as const;
export type InboundEmailsTag = (typeof INBOUND_EMAILS_TAG_VALUES)[number];

// notifications.statut (source: in, last migration: 20260505600000_audit_email_h3_m5_email_suppressions.sql)
export const NOTIFICATIONS_STATUT_VALUES = ["sent", "failed", "skipped"] as const;
export type NotificationsStatut = (typeof NOTIFICATIONS_STATUT_VALUES)[number];

// notifications.type (source: in, last migration: 20260419000000_initial_schema.sql)
export const NOTIFICATIONS_TYPE_VALUES = ["email", "sms"] as const;
export type NotificationsType = (typeof NOTIFICATIONS_TYPE_VALUES)[number];

// orders.statut (source: in, last migration: 20260507B00000_cluster_c_drop_ready_status.sql)
export const ORDERS_STATUT_VALUES = ["pending", "confirmed", "completed", "cancelled", "refunded"] as const;
export type OrdersStatut = (typeof ORDERS_STATUT_VALUES)[number];

// payouts.statut (source: in, last migration: 20260429010000_payouts_statut_enum_extend.sql)
export const PAYOUTS_STATUT_VALUES = ["pending", "processing", "paid", "failed"] as const;
export type PayoutsStatut = (typeof PAYOUTS_STATUT_VALUES)[number];

// producer_interest_followups.channel (source: in, last migration: 20260522090000_leads_crm_columns_and_followups.sql)
export const PRODUCER_INTEREST_FOLLOWUPS_CHANNEL_VALUES = ["email", "phone", "rdv"] as const;
export type ProducerInterestFollowupsChannel = (typeof PRODUCER_INTEREST_FOLLOWUPS_CHANNEL_VALUES)[number];

// producer_interest_followups.direction (source: in, last migration: 20260522090000_leads_crm_columns_and_followups.sql)
export const PRODUCER_INTEREST_FOLLOWUPS_DIRECTION_VALUES = ["outbound", "inbound"] as const;
export type ProducerInterestFollowupsDirection = (typeof PRODUCER_INTEREST_FOLLOWUPS_DIRECTION_VALUES)[number];

// producer_interests.source (source: in, last migration: 20260426000000_add_source_to_producer_interests.sql)
export const PRODUCER_INTERESTS_SOURCE_VALUES = ["formulaire_public", "invitation_directe"] as const;
export type ProducerInterestsSource = (typeof PRODUCER_INTERESTS_SOURCE_VALUES)[number];

// producer_interests.statut (source: in, last migration: 20260419000000_initial_schema.sql)
export const PRODUCER_INTERESTS_STATUT_VALUES = ["new", "contacted", "onboarded"] as const;
export type ProducerInterestsStatut = (typeof PRODUCER_INTERESTS_STATUT_VALUES)[number];

// producers.abonnement_niveau (source: in, last migration: 20260419000000_initial_schema.sql)
export const PRODUCERS_ABONNEMENT_NIVEAU_VALUES = ["starter", "pro", "premium"] as const;
export type ProducersAbonnementNiveau = (typeof PRODUCERS_ABONNEMENT_NIVEAU_VALUES)[number];

// producers.especes (source: subset_array, last migration: 20260419000000_initial_schema.sql)
export const PRODUCERS_ESPECES_VALUES = ["bovin", "porcin", "ovin"] as const;
export type ProducersEspeces = (typeof PRODUCERS_ESPECES_VALUES)[number];

// producers.forme_juridique (source: in, last migration: 20260421400000_producers_forme_juridique_type_production.sql)
export const PRODUCERS_FORME_JURIDIQUE_VALUES = ["gaec", "earl", "ei", "scea", "sas", "sarl", "autre"] as const;
export type ProducersFormeJuridique = (typeof PRODUCERS_FORME_JURIDIQUE_VALUES)[number];

// producers.labels (source: subset_array, last migration: 20260419000000_initial_schema.sql)
export const PRODUCERS_LABELS_VALUES = ["label_rouge", "bio", "aop", "boeuf_fermier_maine"] as const;
export type ProducersLabels = (typeof PRODUCERS_LABELS_VALUES)[number];

// producers.statut (source: in, last migration: 20260422200000_rgpd_account_deletion.sql)
export const PRODUCERS_STATUT_VALUES = ["draft", "pending", "active", "public", "suspended", "deleted"] as const;
export type ProducersStatut = (typeof PRODUCERS_STATUT_VALUES)[number];

// producers.type_production (source: in, last migration: 20260421400000_producers_forme_juridique_type_production.sql)
export const PRODUCERS_TYPE_PRODUCTION_VALUES = ["maraichage", "elevage", "laiterie", "boulangerie", "vin", "arboriculture", "apiculture", "autre"] as const;
export type ProducersTypeProduction = (typeof PRODUCERS_TYPE_PRODUCTION_VALUES)[number];

// products.pickup_availability_mode (source: in, last migration: 20260529110000_product_slot_availability_model.sql)
export const PRODUCTS_PICKUP_AVAILABILITY_MODE_VALUES = ["all_shared_slots", "selected_slots"] as const;
export type ProductsPickupAvailabilityMode = (typeof PRODUCTS_PICKUP_AVAILABILITY_MODE_VALUES)[number];

// products.unite (source: in, last migration: 20260419000000_initial_schema.sql)
export const PRODUCTS_UNITE_VALUES = ["kg", "piece", "colis"] as const;
export type ProductsUnite = (typeof PRODUCTS_UNITE_VALUES)[number];

// refund_incident_attempts.outcome (source: in, last migration: 20260501231300_t102_1_refund_incidents.sql)
export const REFUND_INCIDENT_ATTEMPTS_OUTCOME_VALUES = ["failed", "succeeded"] as const;
export type RefundIncidentAttemptsOutcome = (typeof REFUND_INCIDENT_ATTEMPTS_OUTCOME_VALUES)[number];

// refund_incidents.kind (source: in, last migration: 20260507120000_t102_2_manual_cancel_kind.sql)
export const REFUND_INCIDENTS_KIND_VALUES = ["revival", "admin", "timeout", "manual_cancel"] as const;
export type RefundIncidentsKind = (typeof REFUND_INCIDENTS_KIND_VALUES)[number];

// refund_incidents.status (source: in, last migration: 20260501231300_t102_1_refund_incidents.sql)
export const REFUND_INCIDENTS_STATUS_VALUES = ["pending", "retrying", "succeeded", "exhausted", "manually_resolved", "aborted"] as const;
export type RefundIncidentsStatus = (typeof REFUND_INCIDENTS_STATUS_VALUES)[number];

// reviews.producer_response_status (source: in, last migration: 20260506140214_add_producer_responses_and_notification_prefs.sql)
export const REVIEWS_PRODUCER_RESPONSE_STATUS_VALUES = ["published", "removed_admin", "removed_producer"] as const;
export type ReviewsProducerResponseStatus = (typeof REVIEWS_PRODUCER_RESPONSE_STATUS_VALUES)[number];

// reviews.statut (source: in, last migration: 20260419000000_initial_schema.sql)
export const REVIEWS_STATUT_VALUES = ["pending", "published", "rejected"] as const;
export type ReviewsStatut = (typeof REVIEWS_STATUT_VALUES)[number];

// slot_rules.availability_scope (source: in, last migration: 20260529110000_product_slot_availability_model.sql)
export const SLOT_RULES_AVAILABILITY_SCOPE_VALUES = ["shared", "product_restricted"] as const;
export type SlotRulesAvailabilityScope = (typeof SLOT_RULES_AVAILABILITY_SCOPE_VALUES)[number];

// slot_rules.mode (source: in, last migration: 20260524140000_slot_rules_mode_column.sql)
export const SLOT_RULES_MODE_VALUES = ["libre", "rdv"] as const;
export type SlotRulesMode = (typeof SLOT_RULES_MODE_VALUES)[number];

// slots.availability_scope (source: in, last migration: 20260529110000_product_slot_availability_model.sql)
export const SLOTS_AVAILABILITY_SCOPE_VALUES = ["shared", "product_restricted"] as const;
export type SlotsAvailabilityScope = (typeof SLOTS_AVAILABILITY_SCOPE_VALUES)[number];

// users.roles (source: subset_array, last migration: 20260421100000_cumulative_roles_admin_users.sql)
export const USERS_ROLES_VALUES = ["consumer", "producer"] as const;
export type UsersRoles = (typeof USERS_ROLES_VALUES)[number];
