import { Suspense } from "react";
import Link from "next/link";
import { AdminPageHeader } from "@/components/ui/admin-page-header";
import { MetricCard } from "@/components/ui/metric-card";
import { formatEuro } from "@/lib/format/currency";
import { fetchAdminDashboard } from "@/lib/admin/dashboard/fetch";
import { centsToEuro } from "@/lib/admin/dashboard/types";
import {
  DASHBOARD_PERIODS,
  PERIOD_LABELS,
  parseDashboardPeriod,
  type DashboardPeriod,
} from "@/lib/admin/dashboard/period";
import { DashboardSkeleton } from "../_components/ContentSkeletons";
import { CockpitCard } from "./_components/CockpitCard";
import { RecentActivityTable } from "./_components/RecentActivityTable";

// Chantier 2 — dashboard admin refonte. Server Component dynamique. RPC
// SECURITY DEFINER `get_admin_dashboard(p_period)` via service_role.
// Zones (ordre) : 1. Période (bandeau temporel + 4 KPIs) → 2. À traiter
// (cockpit, toutes cartes cliquables) → 3. Conversion invitations 30j →
// 4. Activité récente.
//
// Pas de barrel `@/components/ui` (Footer transitif throw sans NEXT_PUBLIC_APP_URL
// en tests jsdom). Fail-safe : RPC null → état d'erreur lisible, pas de 500.

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Coquille synchrone : la page rend le trou <Suspense> immédiatement
// (le header + la sidebar admin du layout restent fixes), le contenu
// (RPC get_admin_dashboard) est streamé.
export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const sp = await searchParams;
  const period = parseDashboardPeriod(sp.period);

  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <AdminDashboardContent period={period} />
    </Suspense>
  );
}

// Exporté pour les tests unitaires : c'est ici que vit la logique data (RPC
// dashboard + rendu des zones). La page n'est plus qu'une coquille <Suspense>.
export async function AdminDashboardContent({
  period,
}: {
  period: DashboardPeriod;
}) {
  const data = await fetchAdminDashboard(period);

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

  const { period: kpi, cockpit, conversion_30d: conv, recent_events } = data;

  return (
    <div>
      <AdminPageHeader
        eyebrow="Pilotage"
        title="Tableau de bord"
        subtitle="État du back-office TerrOir"
      />

      {/* ─── Zone 1 — Période (bandeau temporel) ─────────────────────── */}
      <section className="mb-10">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.18em] text-gray-600">
            Activité sur la période
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {DASHBOARD_PERIODS.map((p) => (
              <Link
                key={p}
                href={p === "today" ? "/tableau-de-bord" : `/tableau-de-bord?period=${p}`}
                className={`rounded-full px-3 py-1 text-[13px] transition-colors ${
                  p === period
                    ? "bg-green-700 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {PERIOD_LABELS[p]}
              </Link>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Commandes" value={kpi.orders_count} hint="Créées sur la période" />
          <MetricCard
            label="Chiffre d'affaires"
            value={formatEuro(centsToEuro(kpi.revenue_cents))}
            hint="Commandes complétées sur la période"
          />
          <MetricCard
            label="Consommateurs actifs"
            value={kpi.active_consumers}
            hint="Au moins 1 commande passée"
          />
          <MetricCard
            label="Producteurs actifs"
            value={kpi.active_producers}
            hint="Au moins 1 commande reçue"
          />
        </div>
      </section>

      {/* ─── Zone 2 — À traiter (cockpit) ────────────────────────────── */}
      <section className="mb-10">
        <h2 className="mb-4 text-[12px] font-semibold uppercase tracking-[0.18em] text-gray-600">
          À traiter
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <CockpitCard
            label="Remboursements en attente"
            count={cockpit.refunds_pending_count}
            hint="Demandes producteur > cap, à arbitrer"
            href="/refunds/pending"
          />
          <CockpitCard
            label="Litiges ouverts"
            count={cockpit.disputes_open_count}
            hint="Chargebacks Stripe à traiter"
            href="/litiges"
          />
          <CockpitCard
            label="Avis à modérer"
            count={cockpit.reviews_pending_count}
            hint="Avis consommateur en attente de publication"
            href="/avis"
          />
          <CockpitCard
            label="Producteurs à valider"
            count={cockpit.producers_pending_validation_count}
            hint="Onboarding terminé, en attente de décision"
            href="/gestion-producteurs?status=pending"
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
            label="Incidents de remboursement"
            count={cockpit.refund_incidents_count}
            hint="Remboursements Stripe échoués (cron retry)"
            href="/refund-incidents"
          />
          <CockpitCard
            label="Invitations expirées"
            count={cockpit.invitations_expired_count}
            hint="Lien envoyé mais jamais consommé"
            href="/invitations"
          />
        </div>
      </section>

      {/* ─── Zone 3 — Conversion invitations (30 jours) ──────────────── */}
      <section className="mb-10">
        <h2 className="mb-4 text-[12px] font-semibold uppercase tracking-[0.18em] text-gray-600">
          Conversion invitations (30 derniers jours)
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <MetricCard label="Invitations envoyées" value={conv.invitations_sent} />
          <MetricCard label="Onboardings complétés" value={conv.onboardings_completed} />
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

      {/* ─── Zone 4 — Activité récente ───────────────────────────────── */}
      <section>
        <h2 className="mb-4 text-[12px] font-semibold uppercase tracking-[0.18em] text-gray-600">
          Activité récente
        </h2>
        <RecentActivityTable events={recent_events} />
      </section>
    </div>
  );
}
