// Types partagés cluster admin/users (PR3 admin-new-surfaces, audit § 6 P2 #9
// — gap surface users globale). Source de vérité pour la page liste, la
// page détail (4 onglets) et leurs tests.
//
// Doctrine d'accès :
//   - public.users n'a aucune policy admin RLS (cf. AUDIT_ADMIN § 4.4), donc
//     toutes les lectures admin passent par service_role.
//   - auth.users n'est pas exposable directement via PostgREST côté browser,
//     mais service_role peut faire un .schema("auth").from("users") — c'est
//     ce qu'on utilise pour récupérer last_sign_in_at / email_confirmed_at /
//     phone_confirmed_at qui ne sont PAS dans public.users.
//   - PR3 = visualisation seule, pas de WRITE → pas d'API route mutative,
//     pas d'audit log.

// Rôle métier — mappé depuis la colonne array public.users.roles. Conventions
// du projet : un user peut être consumer + producer, mais en pratique pour
// l'UI on affiche le rôle "principal". 'admin' est dérivé de la jointure
// admin_users (whitelist), pas de public.users.roles.
export type AdminUserRole = "consumer" | "producer" | "admin";

// Filtres UI exposés en search params de la page liste. 'all' = pas de
// filtre rôle, les autres ciblent la valeur exacte.
export type AdminUserRoleFilter = "all" | AdminUserRole;

// Row user telle qu'exposée par la page admin liste — formatée côté fetcher
// (joinedAt formaté FR, role label, count commandes). Le client ne connaît
// pas la structure DB.
export type AdminUserRow = {
  id: string;
  email: string;
  // Nom complet calculé (prenom + nom). "—" si rien renseigné.
  fullName: string;
  // Rôle principal affiché. Si plusieurs rôles, on prend la précédence
  // admin > producer > consumer.
  role: AdminUserRole;
  // ISO brut de auth.users.last_sign_in_at (null si jamais connecté).
  lastSignInAt: string | null;
  // Formaté FR (created_at). Toujours présent (default NOW() à la création).
  joinedAt: string;
  // Count des orders du user (consumer_id = id). Approx, pas exact head.
  ordersCount: number;
};

// Détail user — page /users/[id] header + onglet Profil.
export type AdminUserDetail = {
  id: string;
  email: string;
  prenom: string | null;
  nom: string | null;
  telephone: string | null;
  role: AdminUserRole;
  roles: string[];
  smsOptin: boolean | null;
  // Brut ISO — formaté côté UI.
  createdAt: string;
  // auth.users — peut être null si la row auth a été supprimée hors process
  // (tombstone) ou si le mirror a divergé.
  lastSignInAt: string | null;
  emailConfirmedAt: string | null;
  phoneConfirmedAt: string | null;
};

// Onglet Commandes — denormalize producer.nom_exploitation côté fetcher.
export type AdminUserOrder = {
  id: string;
  codeCommande: string | null;
  createdAt: string;
  statut: string;
  montantTotal: number | null;
  producerName: string;
};

// Onglet Reviews — denormalize producer.nom_exploitation côté fetcher.
export type AdminUserReview = {
  id: string;
  createdAt: string;
  producerName: string;
  note: number | null;
  statut: string | null;
  // Commentaire tronqué à 200 chars pour la table. Si tronqué, on suffixe "…".
  commentaireExcerpt: string;
};

// Onglet Notifications — schéma notifications volontairement simple
// (cf. AUDIT_ADMIN § 6 P1 deliverability). Pas de subject/body séparés en DB,
// on extrait depuis `metadata` jsonb si présent + on expose template comme
// "subject équivalent".
export type AdminUserNotification = {
  id: string;
  createdAt: string;
  // 'email' | 'sms' (colonne `type` en DB).
  channel: string | null;
  // 'sent' | 'failed' (colonne `statut` en DB).
  status: string | null;
  // Template logique (ex: 'producer_invitation', 'order_confirmed_producer').
  // Sert d'identifiant fonctionnel — le sujet humain réel vit dans la
  // template Resend, pas en DB.
  template: string;
  // Best-effort : si metadata.subject existe, on l'expose, sinon "—".
  subjectExcerpt: string;
};

// Filtre rôle : précédence pour rangs multiples (consumer + producer = "producer"
// car producer implique consumer côté produit). 'admin' est appliqué en
// surcharge depuis la jointure admin_users.
export function deriveRole(
  roles: readonly string[] | null | undefined,
  isAdmin: boolean,
): AdminUserRole {
  if (isAdmin) return "admin";
  if ((roles ?? []).includes("producer")) return "producer";
  return "consumer";
}
