// Types partagés cluster admin/invitations — chantier PR3
// feature/admin-new-surfaces, suite audit AUDIT_ADMIN § 6 P1 #6 (pas de
// listing admin des invitations sortantes). Source de vérité pour le
// Server Component /invitations, le sub-client de filtres, l'API route
// POST /api/admin/invitations/[id]/revoke et les tests.
//
// IMPORTANT — la table `producer_invitations` n'a PAS de colonne `status`.
// L'état est COMPUTED côté query à partir de 3 colonnes :
//   - used_at      (consumed)
//   - expires_at   (expired)
//   - revoked_at   (revoked) — ajoutée par la migration de PR3
// Précédence (cf. fetch.ts mapRowStatus + tests) :
//   1. used_at IS NOT NULL  → consumed  (gagne sur revoked si row corrompue)
//   2. revoked_at IS NOT NULL → revoked
//   3. expires_at < now()   → expired
//   4. else                 → sent

export type InvitationStatus = "sent" | "consumed" | "expired" | "revoked";

// Labels FR pour affichage UI (badges + filter tabs). Centralisés ici pour
// éviter la duplication entre la table et les tabs.
export const INVITATION_STATUS_LABELS: Record<InvitationStatus, string> = {
  sent: "Envoyée",
  consumed: "Consommée",
  expired: "Expirée",
  revoked: "Révoquée",
};

// Row invitation telle qu'exposée par la page admin (denormalisée +
// jointure admin_users.email sur created_by). Le statut est déjà computed
// côté fetcher pour que le client n'ait pas à reproduire la logique.
export type AdminInvitationRow = {
  id: string;
  email: string;
  status: InvitationStatus;
  // ISO timestamps bruts — le client formate via formatDateFr().
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  createdByEmail: string | null;
};

// Filtres exposés dans la page. 'all' = pas de filtre statut, les autres
// ciblent un état computed.
export type InvitationStatusFilter = "all" | InvitationStatus;
