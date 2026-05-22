import { AdminPageHeader } from "@/components/ui/admin-page-header";
import { MetricCard } from "@/components/ui/metric-card";
import { formatEuro } from "@/lib/format/currency";
import { fetchAdminDashboard } from "@/lib/admin/dashboard/fetch";
import { centsToEuro } from "@/lib/admin/dashboard/types";
import { CockpitCard } from "./_components/CockpitCard";
import { RecentActivityTable } from "./_components/RecentActivityTable";

// PR2 admin dashboard — page d'accueil back-office. Server Component
// dynamique : appelle la RPC SECURITY DEFINER `get_admin_dashboard()` via
// `createSupabaseAdminClient` (service_role). Trois zones :
//   1. Cockpit : 6 compteurs d'attention (refunds pending, disputes…),
//      opacité réduite quand count=0, clickable vers la page domaine.
//   2. Business : 3 cards "Aujourd'hui" + 5 cards "7 derniers jours" +
//      funnel invitation 30j.
//   3. Recent events : table 15 derniers events whitelist, clickable vers
//      /audit-logs?event_type=<event> pour drill-down.
//
// Pas de import barrel `@/components/ui` : Footer transitif throw quand
// NEXT_PUBLIC_APP_URL absent (tests jsdom). On importe directement.
//
// Fail-safe : si la RPC retourne null (DB down, etc.), on affiche un état
// d'erreur lisible plutôt qu'un crash 500.

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminDashboardPage() {
  const data = await fetchAdminDashboard();

  if (!data) {
    return (
      <div>
        <AdminPageHeader
          eyebrow="Pilotage"
          title="Tableau de bord"
          subtitle="État du back-office TerrOir"
          error="Impossible de charger les indicateurs. Réessayer dans quelques instants."
        />
      </div>
    );
  }

  const { cockpit, business, recent_events } = data;
  const conv = business.invitation_conversion_30d;

  return (
    <div>
      <AdminPageHeader
        eyebrow="Pilotage"
        title="Tableau de bord"
        subtitle="État du back-office TerrOir"
      />

      {/* ─── Zone 1 — Cockpit (compteurs d'attention) ───────────────── */}
      <section className="mb-10">
        <h2 className="mb-4 text-[12px] font-semibold uppercase tracking-[0.18em] text-gray-600">
          À traiter
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <CockpitCard
            label="Refunds en attente"
            count={cockpit.refunds_pending_count}
            hint="Demandes producteur > cap, à arbitrer"
            href="/refunds/pending"
          />
          <CockpitCard
            label="Litiges ouverts"
            count={cockpit.disputes_open_count}
            hint="Chargebacks Stripe à traiter"
            href="#"
            pending
          />
          <CockpitCard
            label="Avis à modérer"
            count={cockpit.reviews_pending_count}
            hint="Avis consumer en attente de publication"
            href="/avis"
          />
          <CockpitCard
            label="Producteurs à valider"
            count={cockpit.producers_pending_validation_count}
            hint="Onboarding terminé, en attente de décision"
            href="/gestion-producteurs"
          />
          <CockpitCard
            label="Publications à valider"
            count={cockpit.publications_pending_count}
            hint="Producteurs ayant demandé la mise en ligne"
            href="/gestion-producteurs"
          />
          <CockpitCard
            label="Certifications bio à valider"
            count={cockpit.bio_pending_count}
            hint="Bio déclaré, certificat à vérifier"
            href="/gestion-producteurs"
          />
          <CockpitCard
            label="Incidents refund"
            count={cockpit.refund_incidents_count}
            hint="Refunds Stripe échoués (cron retry)"
            href="#"
            pending
          />
          <CockpitCard
            label="Invitations expirées"
            count={cockpit.invitations_expired_count}
            hint="Lien envoyé mais jamais consommé"
            href="#"
            pending
          />
        </div>
      </section>

      {/* ─── Zone 2 — Santé business ─────────────────────────────────── */}
      <section className="mb-10">
        <h2 className="mb-4 text-[12px] font-semibold uppercase tracking-[0.18em] text-gray-600">
          Aujourd&rsquo;hui
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard
            label="Commandes"
            value={business.orders_today_count}
            hint="Créées depuis 00:00 (heure Paris)"
          />
          <MetricCard
            label="Chiffre d'affaires"
            value={formatEuro(centsToEuro(business.revenue_today_cents))}
            hint="Total commandes complétées"
          />
          <MetricCard
            label="Nouveaux comptes"
            value={business.new_users_today_count}
            hint="Inscriptions consumer + producteur"
          />
        </div>
      </section>

      <section className="mb-10">
        <h2 className="mb-4 text-[12px] font-semibold uppercase tracking-[0.18em] text-gray-600">
          7 derniers jours
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard
            label="Commandes"
            value={business.orders_7d_count}
            hint="Toutes commandes créées"
          />
          <MetricCard
            label="Chiffre d'affaires"
            value={formatEuro(centsToEuro(business.revenue_7d_cents))}
            hint="Total commandes complétées"
          />
          <MetricCard
            label="Taux de complétion"
            value={`${business.completion_rate_7d.toFixed(1).replace(".", ",")} %`}
            hint="Commandes complétées / créées"
          />
          <MetricCard
            label="Producteurs actifs"
            value={business.active_producers_7d}
            hint="Au moins 1 commande reçue"
          />
          <MetricCard
            label="Producteurs visibles"
            value={business.total_producers}
            hint="Statut actif ou public"
          />
        </div>
      </section>

      <section className="mb-10">
        <h2 className="mb-4 text-[12px] font-semibold uppercase tracking-[0.18em] text-gray-600">
          Conversion invitations (30 derniers jours)
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <MetricCard
            label="Invitations envoyées"
            value={conv.invitations_sent}
          />
          <MetricCard
            label="Onboardings complétés"
            value={conv.onboardings_completed}
          />
          <MetricCard
            label="Taux de conversion"
            value={
              conv.rate_pct === null
                ? "—"
                : `${conv.rate_pct.toFixed(1).replace(".", ",")} %`
            }
            hint={
              conv.rate_pct === null
                ? "Aucune invitation sur la fenêtre"
                : `${conv.onboardings_completed} / ${conv.invitations_sent}`
            }
          />
        </div>
      </section>

      {/* ─── Zone 3 — Activité récente ───────────────────────────────── */}
      <section>
        <h2 className="mb-4 text-[12px] font-semibold uppercase tracking-[0.18em] text-gray-600">
          Activité récente
        </h2>
        <RecentActivityTable events={recent_events} />
      </section>
    </div>
  );
}
