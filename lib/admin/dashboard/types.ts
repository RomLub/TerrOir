// Types JSON retournés par la RPC `public.get_admin_dashboard()`
// (cf. migration 20260513124041_create_get_admin_dashboard.sql).
//
// Convention :
//  - Tous les compteurs sont des entiers ≥ 0 (jamais null).
//  - Tous les montants sont en centimes EUR (entiers). Conversion vers
//    euros côté UI via `centsToEuro` (cf. helper local plus bas).
//  - `completion_rate_7d` et `invitation_conversion_30d.rate_pct` sont
//    des pourcentages 0..100 avec 1 décimale (round(... * 1000) / 10).
//    `rate_pct` est null UNIQUEMENT quand `invitations_sent = 0` (évite
//    la division par zéro côté SQL). `completion_rate_7d` retourne 0
//    quand `orders_7d_count = 0` (pas null, plus simple côté UI).
//  - `recent_events` : array de 0 à 15 entries, ordonné DESC sur
//    (created_at, id). Whitelist appliquée côté RPC (cf. migration).

export type AdminDashboardCockpit = {
  refunds_pending_count: number;
  disputes_open_count: number;
  reviews_pending_count: number;
  producers_pending_validation_count: number;
  refund_incidents_count: number;
  invitations_expired_count: number;
  // Chantier 3 Phase 6.
  publications_pending_count: number;
  bio_pending_count: number;
};

export type AdminDashboardInvitationConversion = {
  invitations_sent: number;
  onboardings_completed: number;
  // null quand invitations_sent = 0 (évite la division par zéro côté SQL).
  rate_pct: number | null;
};

// Chantier 2 — bloc « période » du bandeau temporel (4 KPIs sur la période
// sélectionnée : Aujourd'hui / Cette semaine / Ce mois-ci / Cette année).
// « actifs » = comptes ayant transacté sur la période (distinct consumer_id /
// producer_id sur les commandes créées dans la fenêtre).
export type AdminDashboardPeriod = {
  orders_count: number;
  revenue_cents: number;
  active_consumers: number;
  active_producers: number;
};

export type AdminDashboardRecentEvent = {
  id: string;
  event_type: string;
  user_id: string | null;
  // metadata JSONB peut être n'importe quoi (event-dependant). Le rendu
  // UI extrait des champs spécifiques au best-effort (`order_id`,
  // `email_masked`) sans typer chaque shape.
  metadata: Record<string, unknown>;
  created_at: string; // ISO timestamptz
};

export type AdminDashboardData = {
  period: AdminDashboardPeriod;
  cockpit: AdminDashboardCockpit;
  conversion_30d: AdminDashboardInvitationConversion;
  recent_events: AdminDashboardRecentEvent[];
};

// Helper conversion centimes → euros. Renvoie un nombre (à formater via
// `formatEuro` de lib/format/currency.ts pour l'affichage final).
export function centsToEuro(cents: number): number {
  return cents / 100;
}
