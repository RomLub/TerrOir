import { Suspense } from "react";
import Link from "next/link";
import { AdminPageHeader, MetricCard } from "@/components/ui";
import { getInvitationConversionStats } from "@/lib/audit-logs/invitation-conversion-stats";
import { SectionSkeleton } from "../../_components/ContentSkeletons";

// T-085 — Dashboard taux de conversion invitation → onboarding complet.
// Page minimale 3 cards : invitations envoyées (30j), onboardings complétés
// (30j), taux %. Décliné explicitement de la doctrine produit "cluster
// admin_invite_*" (T-081) : exploite les events déjà captés sans schéma
// supplémentaire ni écriture DB.
//
// Server component dynamique : lecture via service_role bypass RLS pour
// agrégation count(). Le layout `(admin)` impose déjà la session admin —
// pas de check supplémentaire ici (cohérent avec /audit-logs).
//
// Pas de filtre temporel UI au lancement : 30 jours est la fenêtre
// pertinente pour le pilotage recrutement producteur Sarthe. L'admin a
// `/audit-logs` avec date_from / date_to + filtre `admin_invite_sent` pour
// affiner ad-hoc.


// Coquille SYNCHRONE (streaming Suspense) : aucun accès dynamique en tête,
// l'en-tête + la note explicative s'affichent immédiatement (shell admin fixe),
// les métriques (agrégation count) sont streamées via <Suspense>.
export default function AuditLogsStatsPage() {
  return (
    <div>
      <AdminPageHeader
        eyebrow="Sécurité"
        title="Conversion invitations"
        subtitle="Funnel recrutement producteur sur 30 jours glissants"
        right={
          <Link
            href="/audit-logs"
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-[13px] text-gray-700 transition-colors hover:bg-gray-50"
          >
            ← Journal d&rsquo;audit
          </Link>
        }
      />

      <Suspense fallback={<SectionSkeleton rows={3} />}>
        <StatsContent />
      </Suspense>

      <p className="mt-6 max-w-2xl text-[12px] text-gray-500">
        Ces métriques sont approximatives : un onboarding complété aujourd&rsquo;hui
        peut découler d&rsquo;une invitation plus ancienne que 30 jours. Pour un
        funnel cohorté précis, croiser avec la table{" "}
        <span className="font-mono text-[11px]">producer_invitations</span>{" "}
        (sent_at vs used_at).
      </p>
    </div>
  );
}

async function StatsContent() {
  let stats: Awaited<ReturnType<typeof getInvitationConversionStats>> | null;
  let errorMsg: string | null = null;
  try {
    stats = await getInvitationConversionStats();
  } catch (err) {
    errorMsg = (err as Error).message;
    stats = null;
  }

  return (
    <>
      {errorMsg ? (
        <p className="mb-4 text-[13px] text-red-600" role="alert">
          {errorMsg}
        </p>
      ) : null}

      {stats && (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard
            label="Invitations envoyées (30j)"
            value={stats.invitationsSent}
            hint="Event admin_invite_sent (hors relances)"
          />
          <MetricCard
            label="Onboardings complétés (30j)"
            value={stats.onboardingsCompleted}
            hint="Event invitation_consumed_success"
          />
          <MetricCard
            label="Taux de conversion"
            value={
              stats.conversionRatePct === null
                ? "—"
                : `${stats.conversionRatePct} %`
            }
            hint={
              stats.conversionRatePct === null
                ? "Aucune invitation sur la fenêtre"
                : `${stats.onboardingsCompleted} / ${stats.invitationsSent}`
            }
          />
        </section>
      )}
    </>
  );
}
