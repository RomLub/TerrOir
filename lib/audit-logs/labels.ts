// T-084 — Map des libellés humains FR par event_type pour l'UI admin
// /audit-logs. Source unique : tout call site qui affiche un event_type
// dans une UI doit passer par getEventLabel(eventType).
//
// Pourquoi un mapping séparé du fichier event-types.ts (côté page) plutôt
// qu'inline dans chaque helper logXxxEvent : isolation des concerns. Les
// helpers en `lib/audit-logs/log-*.ts` sont importés par des server actions
// auth-sensitives, on évite d'y câbler de la string UI (testabilité, build
// trees plus propres). Le mapping vit dans `lib/audit-logs/labels.ts` pour
// rester réutilisable côté n'importe quelle UI future (admin, dashboard,
// notifications) sans dupliquer.
//
// Fallback `eventType` brut si pas de mapping — un nouvel event_type ne
// casse pas l'UI (juste affichage technique). Le test parité (cf.
// tests/lib/audit-logs/labels.test.ts) garantit que tous les event_types
// connus dans ALL_EVENT_TYPES ont un libellé explicite.

export const AUDIT_EVENT_LABELS: Record<string, string> = {
  // ─── Auth (Phase 1 + extensions) ────────────────────────────────────
  password_reset_request: "Demande de réinitialisation mot de passe",
  password_changed: "Mot de passe modifié",
  account_login_password: "Connexion (mot de passe)",
  account_login_magic_link: "Connexion (lien magique)",
  account_logout: "Déconnexion",
  account_signup: "Inscription",
  account_deleted: "Compte supprimé",
  email_change: "Changement d'email",
  admin_login: "Connexion admin",
  role_changed: "Rôle modifié",
  invitation_consumed_race_lost: "Invitation : conflit consommation (race)",
  invitation_created: "Invitation créée (DB)",
  invitation_revoked: "Invitation révoquée",
  invitation_consumed_success: "Invitation consommée",
  login_failed: "Échec de connexion",
  rate_limit_exceeded: "Rate-limit dépassé",
  account_otp_requested: "OTP demandé",
  account_otp_verified: "OTP vérifié",
  account_otp_invalid: "OTP invalide",
  account_otp_expired: "OTP expiré",
  account_otp_attempts_exceeded: "OTP : tentatives épuisées",
  account_email_change_completed: "Changement d'email finalisé",

  // ─── Admin invitations producteur ───────────────────────────────────
  admin_invite_sent: "Invitation envoyée",
  admin_invite_draft_resend: "Relance invitation (brouillon)",
  admin_invite_blocked_admin: "Invitation bloquée (déjà admin)",
  admin_invite_blocked_producer: "Invitation bloquée (producteur déjà inscrit)",
  admin_invite_expired: "Invitation expirée (clic)",

  // ─── RGPD ───────────────────────────────────────────────────────────
  user_data_exported: "Export RGPD téléchargé",

  // ─── Commandes ──────────────────────────────────────────────────────
  order_created: "Commande créée",
  order_payment_succeeded: "Paiement réussi",
  order_payment_failed: "Paiement échoué",
  order_revival_succeeded: "Résurrection commande réussie",
  order_revival_blocked_stock: "Résurrection bloquée (stock)",
  order_revival_blocked_slot: "Résurrection bloquée (créneau)",
  order_revival_refund_failed: "Échec refund résurrection",
  order_refund_retried_succeeded: "Refund retenté avec succès",
  order_refund_retry_exhausted: "Refund : tentatives épuisées",
  order_admin_refund_failed: "Échec refund admin",
  order_admin_refund_succeeded: "Refund admin effectué",
  order_producer_refund_succeeded: "Refund producteur effectué",
  order_producer_refund_failed: "Échec refund producteur",
  order_timeout_refund_failed: "Échec refund timeout",
  order_timeout_no_payment: "Timeout commande sans paiement",

  // ─── Stripe (events transverses) ────────────────────────────────────
  stripe_account_updated: "Stripe : compte mis à jour",
  stripe_payout_paid: "Stripe : payout effectué",
  stripe_dispute: "Stripe : litige ouvert",
  stripe_dispute_deadline_warning: "Stripe : alerte deadline litige",
  stripe_dispute_deadline_missed: "Stripe : deadline litige dépassée",
  stripe_transfer_failed: "Stripe : échec transfer",
  stripe_transfer_initiated: "Stripe : transfer initié",
  stripe_payout_failed: "Stripe : échec payout",
  stripe_default_payment_method_set: "Stripe : moyen de paiement par défaut",
  stripe_early_fraud_warning_received: "Stripe : alerte fraude précoce",
  stripe_charge_refunded_settled: "Stripe : refund settlement confirmé",
  stripe_account_deauthorized: "Stripe : compte déconnecté",

  // ─── Email delivery ─────────────────────────────────────────────────
  email_complaint_received: "Plainte spam reçue",
  email_hard_bounce_suppressed: "Bounce permanent (suppression)",

  // ─── Avis & réponse producteur ──────────────────────────────────────
  producer_response_published: "Réponse producteur publiée",
  producer_response_updated: "Réponse producteur modifiée",
  producer_response_deleted_by_producer: "Réponse producteur supprimée (auto)",
  producer_response_removed_by_admin: "Réponse producteur supprimée (admin)",
  notification_preference_updated: "Préférence notification modifiée",

  // ─── Légal / conformité ─────────────────────────────────────────────
  admin_legal_compliance_exported: "Export conformité CGU",
  admin_audit_logs_email_lookup: "Recherche email (audit-logs)",

  // ─── Pickup commande (validation retrait par code producer) ──────────
  pickup_preview_ok: "Aperçu retrait validé",
  pickup_preview_invalid: "Aperçu retrait : code invalide",
  pickup_validated: "Retrait validé (commande remise)",
  pickup_attempt_invalid: "Tentative validation retrait : code invalide",
  pickup_attempt_rate_limited: "Validation retrait : rate-limit dépassé",

  // ─── Review followup (cron J+2 / J+7) ────────────────────────────────
  review_followup_sent_d2: "Relance avis J+2 envoyée",
  review_followup_sent_d7: "Relance avis J+7 envoyée",
  review_followup_skipped: "Relance avis ignorée",
  review_followup_dedup_blocked: "Relance avis bloquée (déjà envoyée)",

  // ─── Producteur — rectification indicateurs (T-232) ─────────────────
  producer_indicateurs_updated: "Indicateurs producteur modifiés",

  // ─── Catalogue / catégorisation produit (T-130) ─────────────────────
  admin_category_created: "Catégorie créée",
  admin_category_updated: "Catégorie modifiée",
  admin_category_deleted: "Catégorie supprimée",
  admin_animal_created: "Espèce animale créée",
  admin_animal_updated: "Espèce animale modifiée",
  admin_animal_deleted: "Espèce animale supprimée",
  admin_cut_created: "Morceau créé",
  admin_cut_updated: "Morceau modifié",
  admin_cut_deleted: "Morceau supprimé",
};

export function getEventLabel(eventType: string): string {
  return AUDIT_EVENT_LABELS[eventType] ?? eventType;
}
