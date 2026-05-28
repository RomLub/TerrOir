import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fetchProducerForUser, type ProducerRecord } from "@/lib/producers/context";
import { PageHeader } from "@/components/ui";
import { computeHealth, type HealthBand } from "@/lib/producers/health";
import { fetchBadgeDetailsForProducer } from "@/lib/producers/fetch-badge-details";
import { SectionSkeleton } from "../_components/ContentSkeletons";

// « Santé de ma boutique » (ADR-0011) — présentation des indicateurs déjà
// calculés (cron weekly-badges). Pure lecture, pas de recompute.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const BAND_TEXT: Record<HealthBand, string> = {
  good: "text-green-700",
  warn: "text-amber-700",
  bad: "text-red-700",
};
const BAND_CARD: Record<HealthBand, string> = {
  good: "border-green-700/25 bg-green-700/[0.04]",
  warn: "border-amber-300/50 bg-amber-50/60",
  bad: "border-red-200 bg-red-50/60",
};
const BAND_LABEL: Record<HealthBand, string> = {
  good: "Très bien",
  warn: "À surveiller",
  bad: "À améliorer",
};

// Coquille SYNCHRONE : le PageHeader s'affiche instantanément ; les gardes
// (session + producteur) sont déplacées dans le flux (SanteGate) → cadre
// instantané à la navigation, indicateurs streamés.
export default function SantePage() {
  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <PageHeader
        tone="producer"
        eyebrow="Pilotage"
        title="Santé de ma boutique"
        subtitle="Vos indicateurs de qualité, mis à jour chaque semaine. Visez le vert pour rassurer vos clients."
      />

      <Suspense fallback={<SectionSkeleton rows={3} />}>
        <SanteGate />
      </Suspense>
    </div>
  );
}

async function SanteGate() {
  const session = await getSessionUser();
  if (!session) redirect("/connexion");

  const admin = createSupabaseAdminClient();
  const producer = await fetchProducerForUser(admin, session.id);
  if (!producer) redirect("/invitation");

  return <SanteContent producer={producer} />;
}

async function SanteContent({ producer }: { producer: ProducerRecord }) {
  const admin = createSupabaseAdminClient();

  const [{ data: row }, badgeComputation] = await Promise.all([
    admin
      .from("producers")
      .select(
        "badge_stock_score, badge_confirmation_score, badge_annulation_score, note_moyenne, nb_avis",
      )
      .eq("id", producer.id)
      .maybeSingle(),
    fetchBadgeDetailsForProducer(admin, producer.id),
  ]);

  const health = computeHealth({
    stock: Number(row?.badge_stock_score ?? 0),
    response: Number(row?.badge_confirmation_score ?? 0),
    reliability: Number(row?.badge_annulation_score ?? 0),
    rating: Number(row?.note_moyenne ?? 0),
    reviewCount: Number(row?.nb_avis ?? 0),
    badgeDetails: badgeComputation.details,
  });

  return (
    <>
      <div
        className={`mb-8 flex items-center justify-between gap-4 rounded-2xl border p-6 ${BAND_CARD[health.overallBand]}`}
      >
        <div>
          <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-dark/55">
            Score global
          </div>
          <div className="mt-1 text-[14px] text-dark/60">
            {BAND_LABEL[health.overallBand]}
          </div>
        </div>
        <div
          className={`font-serif text-[44px] leading-none ${BAND_TEXT[health.overallBand]}`}
        >
          {health.overall} %
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {health.metrics.map((m) => (
          <div
            key={m.key}
            className={`rounded-2xl border p-5 ${BAND_CARD[m.band]}`}
          >
            <div className="flex items-baseline justify-between gap-3">
              <div className="text-[13px] font-semibold text-green-900">
                {m.label}
              </div>
              <div
                className={`font-serif text-[28px] leading-none ${BAND_TEXT[m.band]}`}
              >
                {m.display}
              </div>
            </div>
            <p className="mt-2 text-[13px] text-dark/65">{m.tip}</p>
            {m.detail && (
              <p className="mt-2 text-[11px] text-dark/45 tabular-nums">
                {m.detail}
              </p>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
