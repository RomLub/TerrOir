import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Helper unifié pour pousser un event de paiement sensible dans
// public.audit_logs (cf. migration 20260427100000_create_audit_logs.sql).
//
// Symétrique à `lib/audit-logs/log-auth-event.ts` (Phase 1 audit_logs).
// Phase 2 audit_logs ouvre le périmètre payment_*/refund_* explicitement
// flaggé dans la migration initiale (lignes 16-19) : « simplement pousser
// un nouveau event_type dans la table ». Pas d'extension de schema DB
// nécessaire (event_type est `text`, pas un enum), seul le typing TS
// est étendu côté applicatif.
//
// Contrat fail-safe : un échec d'écriture audit ne doit JAMAIS casser le
// flow paiement principal. Un webhook Stripe doit ack 200 même si la
// table audit est down — sinon Stripe retry le webhook indéfiniment.
// Toutes les erreurs sont swallow + console.warn pour Vercel, jamais
// re-throw.
//
// Pas de fallback IP/UA via headers() Next.js : le call site principal
// est le webhook Stripe, qui est appelé par Stripe (IPs Stripe, peu
// pertinentes forensiquement). Le user_id vient de l'order.consumer_id
// quand disponible, null sinon. Si plus tard on instrumente des call
// sites browser (admin manual revival, etc.), on ajoutera l'option en
// prop facultative.
//
// Service_role obligatoire : la table audit_logs n'a pas de policy INSERT,
// seul le bypass RLS du service_role permet d'écrire. Cohérent avec
// log-auth-event (même contrat).

// T-080 Phase 1 : source unique des event_types Payment. Array runtime
// dérivé en type union pour rester strictement aligné avec la déclaration
// historique (`PaymentEventType`) tout en exposant la liste itérable côté
// UI admin (page /audit-logs filtres). Pas de duplication possible : le
// type est calculé via `(typeof ...)[number]`.
export const PAYMENT_EVENT_TYPES = [
  // T-429 : audit forensique post-création atomique d'une order via la
  // RPC create_order_with_items. Posé dès le retour OK (avant ack HTTP au
  // client), couvre le path happy de POST /api/orders/create. userId =
  // session.id (consumer). Metadata aligne les colonnes DB (orders.id,
  // montant_total, commission_terroir, montant_net_producteur). Compliance
  // RGPD pré-Live : symétrique aux audit_logs cancel/refund/webhook/cron
  // (Bundles 1+3+4) — aucune mutation DB importante n'échappe désormais
  // à l'audit trail.
  "order_created",
  // F-035 + F-036 (audit pré-launch 2026-05-11) — INSERT côté RPC SECDEF
  // (cf. migration 20260510100000_p0_ta_f001_orders_transitions_rpc_secdef.sql)
  // mais surfacés ici pour le typing TS / filtres UI admin /audit-logs.
  // order_confirmed metadata : { order_id, producer_id, by, confirmed_at }.
  // order_cancelled metadata : { order_id, producer_id, consumer_id, by,
  // reason, target_status, cancelled_at }. Le champ `by` discrimine
  // 'admin'|'producer'|'consumer' au niveau RPC interne (caller dispatch).
  "order_confirmed",
  "order_cancelled",
  // Path nominal et failed (instrumentation rétroactive Phase 2).
  "order_payment_succeeded",
  "order_payment_failed",
  // Path résurrection 3DS-retry (P1 commit 49c0f1b).
  "order_revival_succeeded",
  // Paths résurrection bloquée (chantier en cours).
  "order_revival_blocked_stock",
  "order_revival_blocked_slot",
  "order_revival_refund_failed",
  // Path retry cron daily (chantier retry-failed-refunds — scope minimal
  // résurrection bloquée). Cron `/api/cron/retry-failed-refunds` retente
  // jusqu'à 3 fois les refunds bloqués sur le path résurrection. Idempotency
  // Stripe key dérivée de l'order_id + attempt pour empêcher double refund.
  // Sortie de boucle : `_retried_succeeded` (refund OK enfin) OU
  // `_retry_exhausted` (3 attempts épuisés, alerte admin via notifications
  // template='refund_retry_exhausted').
  "order_refund_retried_succeeded",
  "order_refund_retry_exhausted",
  // Paths refund autres que résurrection (chantier T-107 instrumentation
  // pré-requis avant extension du cron retry-failed-refunds aux 3 paths).
  // Aujourd'hui pure instrumentation forensique : le cron retry actuel ne
  // les consomme pas encore. Posent un audit_log à chaque échec
  // `stripe.refunds.create` sur leur path respectif pour permettre la
  // détection background ultérieure.
  "order_admin_refund_failed",
  // Audit Stripe L-5 (2026-05-05) — instrumentation success symétrique au
  // failed historique : trace forensique systématique pour reconstitution
  // chronologie (RGPD + dispute Stripe + détection abus producer).
  "order_admin_refund_succeeded",
  // Audit Stripe L-5 (2026-05-05) — refund producer-owned (path distinct
  // de _admin sans cap, sans approval). Émis par /api/stripe/refund quand
  // l'authoriseur est le producer propriétaire de l'order. Email admin
  // déclenché en parallèle si amount >= SUPPORT_REFUND_THRESHOLD_EUR
  // (default 100).
  "order_producer_refund_succeeded",
  "order_producer_refund_failed",
  // F-014 (audit pré-launch 2026-05-10) — cap dur (default 500€, env
  // PRODUCER_REFUND_CAP_EUR) sur le path producer self-refund. Émis avant
  // le call stripe.refunds.create quand le montant dépasse le cap. La
  // requête est rejetée en 403 + email alerte admin (action requise).
  // Metadata : attempted_amount, cap, order_id, producer_id.
  "producer_refund_cap_exceeded",
  // F-014 v2 (audit P0 sweep 2026-05-11) — workflow approval admin :
  // producer POST refund > cap crée un pending_refund au lieu du 403.
  // Cluster `producer_refund_pending_*` :
  //   - created : INSERT pending_refunds par producer request
  //   - admin_approved : admin approve → déclenche flow Stripe refund
  //   - admin_denied : admin deny → email producer + clos
  //   - expired : cron auto-expire après 7j sans décision
  // Metadata : pending_refund_id, order_id, producer_id, amount, reason.
  "producer_refund_pending_created",
  "producer_refund_admin_approved",
  "producer_refund_admin_denied",
  "producer_refund_pending_expired",
  "order_timeout_refund_failed",
  // Path cron timeout sur order pending non payée (PI status !== 'succeeded').
  // T-409 : skip refund Stripe + audit forensique pour ne pas polluer le
  // cron retry T-412 avec des faux positifs (PI 3DS abandonné, etc.).
  "order_timeout_no_payment",
  // Phase 3 multi-events (T-081 PR-B) — events Stripe directs, pas liés à
  // un order_id spécifique côté plateforme. Préfixe `stripe_` pour
  // disambiguer des events `order_*` ci-dessus. user_id null par défaut
  // (orphelin), traçable a posteriori via metadata (stripe_account_id,
  // payout_id, payment_intent_id).
  "stripe_account_updated",
  "stripe_payout_paid",
  "stripe_dispute",
  // F-039 (audit pré-launch 2026-05-11) — events Stripe `charge.dispute.funds_*`
  // pour traçabilité forensique du débit / re-crédit de la platform balance
  // pendant un dispute. Aucun effet de bord business (pas d'UPDATE DB, pas
  // d'email producer) : audit log uniquement, pour reconstitution comptable
  // post-mortem et réconciliation avec Stripe Dashboard.
  //   - stripe_dispute_funds_withdrawn : Stripe a débité la platform balance
  //     du montant du dispute (provisoire le temps de l'instruction). Émis
  //     sur webhook `charge.dispute.funds_withdrawn`. Metadata : dispute_id,
  //     charge_id, payment_intent_id, amount, currency, reason, status.
  //   - stripe_dispute_funds_reinstated : Stripe a re-crédité la platform
  //     balance (dispute won). Émis sur webhook `charge.dispute.funds_reinstated`.
  //     Metadata identique.
  "stripe_dispute_funds_withdrawn",
  "stripe_dispute_funds_reinstated",
  // Audit Stripe M-4 (2026-05-05) — cron disputes-deadline-check :
  //   - stripe_dispute_deadline_warning : email relance posé (urgency=soon|urgent),
  //     metadata.dispute_id, hours_remaining, urgency, sms_sent (bool).
  //   - stripe_dispute_deadline_missed  : evidence_due_by passée, status reste
  //     needs_response (Stripe va auto-perdre). Marque forensique pour audit
  //     post-mortem.
  "stripe_dispute_deadline_warning",
  "stripe_dispute_deadline_missed",
  // Chantier 8 — actions admin sur un litige depuis la page Litiges :
  //   - stripe_dispute_evidence_saved     : preuves enregistrées (brouillon,
  //     submit=false), modifiable ensuite. metadata.dispute_id, fields_set.
  //   - stripe_dispute_evidence_submitted : preuves soumises définitivement à
  //     Stripe (submit=true) → dispute passe under_review. Irréversible.
  "stripe_dispute_evidence_saved",
  "stripe_dispute_evidence_submitted",
  // Bundle 3 webhook events go-Live (T-401) — Stripe signale les échecs
  // de virement Connect plateforme -> producteur.
  //   - stripe_transfer_failed : Transfer plateforme -> Connect account
  //                              échoué. PAS via webhook (Stripe Connect
  //                              Express n'émet pas l'event transfer.failed
  //                              parce que stripe.transfers.create() est
  //                              synchrone) — log instrumenté côté
  //                              lib/stripe/payouts.ts dans le catch
  //                              synchrone post-stripe.transfers.create()
  //                              (Bundle 2 PR 2b TC). Enum value gardée
  //                              côté audit pour cohérence forensique.
  //   - stripe_payout_failed   : Payout Connect account -> banque producteur
  //                              échoué (handler lib/stripe/handle-payout-failed.tsx,
  //                              webhook payout.failed). Pose statut='failed'
  //                              sur la row payouts (CHECK enum élargi par
  //                              migration 20260429010000 T-422). Alerte
  //                              l'admin via email Resend (SUPPORT_EMAIL)
  //                              + notification placeholder DB.
  "stripe_transfer_failed",
  // T-416 : "stripe_transfer_initiated" — émis après UPDATE 'paid' succès
  // dans processWeeklyPayouts (cron weekly-payout). Pose 1 event par
  // producer dont le transfer Stripe Connect a été créé et confirmé en DB.
  // Couvre les 2 paths success (nominal + resume), discriminés via
  // metadata.resumed: bool.
  // Pas posé sur paths skip (paid/failed/pending legacy/not_ready) ni
  // sur path catch synchrone transfer fail (stripe_transfer_failed
  // existant suffit). Pas posé sur crash UPDATE 'paid' (placement
  // post-UPDATE → trade-off connu : récupération via Stripe API + log
  // greppable [WEEKLY_PAYOUT_UPDATE_FAILED]).
  // userId = null (traçable via metadata.producer_id, cohérent
  // stripe_transfer_failed). Format cents (cohérent Stripe API +
  // stripe_transfer_failed existant).
  "stripe_transfer_initiated",
  "stripe_payout_failed",
  // T-431 : stripe_default_payment_method_set — émis quand le default
  // payment method d'un Customer Stripe est modifié via
  // app/api/stripe/ensure-default-payment-method/route.ts (paths F1, F2).
  // Pas émis sur path F3 (detach seul sans changement de default) ni
  // E1 (no-op default déjà set).
  "stripe_default_payment_method_set",
  // Audit Stripe phase 2 M-3 (2026-05-05) — webhook events utiles non
  // abonnés.
  //   - stripe_early_fraud_warning_received : Visa/MC notifient une potentielle
  //     fraude AVANT le dispute. Handler refund pré-emptif (idempotency-key
  //     `refund_${orderId}_efw`) + audit log + email admin. Metadata :
  //     efw_id, charge_id, payment_intent_id, order_id, fraud_type, actionable,
  //     order_match, refund_action ('succeeded'|'failed'|'skipped_*').
  //   - stripe_charge_refunded_settled : Stripe confirme settlement réel d'un
  //     refund (vs émission via refund.created). Metadata : charge_id, order_id,
  //     amount_refunded, refunded (bool), order_match.
  //   - stripe_account_deauthorized : producer disconnecte son Connect account
  //     depuis Dashboard Stripe. Reset flags producer + statut='suspended' +
  //     email URGENT admin. Metadata : stripe_account_id, producer_id,
  //     producer_match (bool).
  "stripe_early_fraud_warning_received",
  "stripe_charge_refunded_settled",
  "stripe_account_deauthorized",
  // F-004 (audit pré-launch 2026-05-10) — clawback proportionnel via
  // stripe.transfers.createReversal sur dispute lost / refund post-completion.
  // Émis par lib/stripe/reverse-transfer.ts. Source discrimine le caller
  // (refund_admin, refund_producer, refund_cancel, refund_timeout,
  // refund_revival_blocked, refund_efw, refund_retry, dispute_lost).
  // Metadata : order_id, producer_id, transfer_id, reversal_id, amount_cents.
  "stripe_transfer_reversed",
  // Path échec : Stripe API throw sur createReversal (transfer_id obsolète,
  // Connect account suspendu, etc.). Audit forensique pour réconciliation
  // manuelle Dashboard. Le caller continue son flow (fail-safe).
  "stripe_transfer_reversal_failed",
  // Audit Email phase 2 H-3 (2026-05-05) — webhook Resend entrant. Trace
  // forensique des events delivery sensibles côté légal/compliance.
  //   - email_complaint_received : email.complained → suppression IMMÉDIATE
  //     + audit log (CASL/RGPD : conserver la trace formelle de la plainte
  //     spam pour défense litige). Metadata : email (clear, traçabilité
  //     serveur), source_resend_id (data.email_id Resend), svix_id.
  //   - email_hard_bounce_suppressed : email.bounced bounce.type='Permanent'
  //     → suppression immédiate. Forensique pour reconstitution chronologie
  //     (quel email a bouncé, quand, source). Metadata identique.
  "email_complaint_received",
  "email_hard_bounce_suppressed",
] as const;

export type PaymentEventType = (typeof PAYMENT_EVENT_TYPES)[number];

type LogPaymentEventParams = {
  eventType: PaymentEventType;
  // user_id optionnel : null pour les events où le consumer_id n'est pas
  // récupérable (order pas encore fetchée, orphelin). La table audit_logs
  // accepte user_id null (cf. migration 20260427100000 ligne 43).
  userId?: string | null;
  metadata?: Record<string, unknown>;
};

export async function logPaymentEvent(
  params: LogPaymentEventParams,
): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("audit_logs").insert({
      user_id: params.userId ?? null,
      event_type: params.eventType,
      metadata: params.metadata ?? {},
      ip_address: null,
      user_agent: null,
    });
    if (error) {
      console.warn(
        `AUDIT_LOG_INSERT_WARN event=${params.eventType} error=${error.message}`,
      );
    }
  } catch (err) {
    console.warn(
      `AUDIT_LOG_WRITE_WARN event=${params.eventType} error=${(err as Error).message}`,
    );
  }
}
