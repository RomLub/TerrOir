import {
  ALIMENTATION_HINTS,
  ALIMENTATION_PUBLIC_LABELS,
  DENSITE_ANIMALE_HINTS,
  DENSITE_ANIMALE_PUBLIC_LABELS,
  MODE_ELEVAGE_HINTS,
  MODE_ELEVAGE_PUBLIC_LABELS,
  type Alimentation,
  type DensiteAnimale,
  type ModeElevage,
} from "@/lib/producers/score-carbone-enums";
import { DistanceWidget } from "./DistanceWidget";

export type ScoreCarbonBlockProps = {
  modeElevage: ModeElevage | null;
  alimentation: Alimentation | null;
  densiteAnimale: DensiteAnimale | null;
  producerLat: number | null;
  producerLng: number | null;
  producerName: string;
};

const DENSITE_TONE: Record<DensiteAnimale, string> = {
  extensive: "bg-terroir-green-100 text-terroir-green-700",
  standard: "bg-terroir-terra-100 text-terroir-terra-700",
  intensive: "bg-orange-100 text-orange-700",
};

export function ScoreCarbonBlock({
  modeElevage,
  alimentation,
  densiteAnimale,
  producerLat,
  producerLng,
  producerName,
}: ScoreCarbonBlockProps) {
  const hasCategorical =
    modeElevage !== null || alimentation !== null || densiteAnimale !== null;
  const hasDistance = producerLat !== null && producerLng !== null;

  if (!hasCategorical && !hasDistance) return null;

  // Titre adaptatif : "Au plus près de l'éleveur" si on a des indicateurs
  // élevage à montrer, "Au plus près de chez toi" sinon (cas maraîcher,
  // boulanger, etc. — pas d'élevage mais le widget distance reste utile).
  // Décision comité review T-200 round 1.
  const heading = hasCategorical
    ? "de l’éleveur."
    : "de chez toi.";
  const intro = hasCategorical
    ? "Trois marqueurs concrets sur la conduite du troupeau, et la distance réelle qui te sépare de la ferme."
    : "La distance réelle qui te sépare de la ferme, à vol d’oiseau.";

  return (
    <section
      id="demarche"
      className="border-y border-terroir-border bg-terroir-bg scroll-mt-32"
    >
      <div className="mx-auto max-w-7xl px-6 py-16 md:py-24">
        <div className="mx-auto max-w-[720px] text-center md:text-left">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-terra-700">
            Notre démarche
          </span>
          <h2 className="mt-4 font-serif text-[32px] font-medium leading-[1.1] tracking-[-0.005em] text-green-900 md:text-[44px]">
            <span className="italic text-terra-700">Au plus près</span>{" "}
            {heading}
          </h2>
          <p className="mt-5 max-w-[560px] text-[15px] leading-[1.55] text-terroir-ink/[0.72] md:max-w-none">
            {intro}
          </p>
        </div>

        {hasCategorical && (
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {modeElevage !== null && (
              <IndicatorCard
                eyebrow="Mode d'élevage"
                label={MODE_ELEVAGE_PUBLIC_LABELS[modeElevage]}
                hint={MODE_ELEVAGE_HINTS[modeElevage]}
                pillClass="bg-terroir-green-100 text-terroir-green-700"
              />
            )}
            {alimentation !== null && (
              <IndicatorCard
                eyebrow="Alimentation"
                label={ALIMENTATION_PUBLIC_LABELS[alimentation]}
                hint={ALIMENTATION_HINTS[alimentation]}
                pillClass="bg-terroir-terra-100 text-terroir-terra-700"
              />
            )}
            {densiteAnimale !== null && (
              <IndicatorCard
                eyebrow="Densité animale"
                label={DENSITE_ANIMALE_PUBLIC_LABELS[densiteAnimale]}
                hint={DENSITE_ANIMALE_HINTS[densiteAnimale]}
                pillClass={DENSITE_TONE[densiteAnimale]}
              />
            )}
          </div>
        )}

        {hasDistance && (
          <div className="mt-8">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-terra-700">
              Distance ferme → toi
            </div>
            <DistanceWidget
              producerLat={producerLat}
              producerLng={producerLng}
              producerName={producerName}
            />
          </div>
        )}
      </div>
    </section>
  );
}

function IndicatorCard({
  eyebrow,
  label,
  hint,
  pillClass,
}: {
  eyebrow: string;
  label: string;
  hint: string;
  pillClass: string;
}) {
  return (
    <div className="rounded-xl border border-terroir-border bg-white p-5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-terroir-muted">
        {eyebrow}
      </div>
      <div className="mt-3">
        {/* Pas de `title` natif : sur mobile (cible n°1 TerrOir), le tooltip
            HTML est inconsistant ou ignoré (pas de hover) et dégrade donc en
            silence. La mini-explication `hint` est déjà rendue en clair sous
            la pill — on évite la redondance et on garantit le même contenu
            sur tous les supports. Décision comité review T-200 round 2. */}
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-[13px] font-medium ${pillClass}`}
        >
          {label}
        </span>
      </div>
      <p className="mt-2 text-[12px] leading-[1.5] text-terroir-ink/[0.6]">
        {hint}
      </p>
    </div>
  );
}
