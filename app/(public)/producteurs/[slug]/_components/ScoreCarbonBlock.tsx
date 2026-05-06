import {
  type Alimentation,
  type DensiteAnimale,
  type ModeElevage,
} from "@/lib/producers/score-carbone-enums";
import { ScoreCarbonIndicators } from "@/components/producer/ScoreCarbonIndicators";
import { DistanceWidget } from "./DistanceWidget";

export type ScoreCarbonBlockProps = {
  modeElevage: ModeElevage | null;
  alimentation: Alimentation | null;
  densiteAnimale: DensiteAnimale | null;
  producerLat: number | null;
  producerLng: number | null;
  producerName: string;
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
            {/* IndicatorCards extraits dans components/producer/ScoreCarbonIndicators
                pour partage avec ScoreCarbonPreview (T-212, aperçu live onboarding). */}
            <ScoreCarbonIndicators
              modeElevage={modeElevage}
              alimentation={alimentation}
              densiteAnimale={densiteAnimale}
            />
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
