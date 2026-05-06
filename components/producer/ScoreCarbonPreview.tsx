"use client";

import {
  type Alimentation,
  type DensiteAnimale,
  type ModeElevage,
} from "@/lib/producers/score-carbone-enums";
import { ScoreCarbonIndicators } from "./ScoreCarbonIndicators";

// Aperçu visuel temps réel des 3 indicateurs score carbone tels qu'ils
// apparaîtront sur la fiche publique du producteur (T-212).
// Réutilise ScoreCarbonIndicators (source unique partagée avec la fiche
// publique consumer) pour garantir la parité visuelle "preview" ↔ "rendu
// final". Utilisé dans :
//   - StepInfos (onboarding producer / reprise draft)
//   - /ma-page (édition post-onboarding)

export type ScoreCarbonPreviewProps = {
  modeElevage: ModeElevage | null;
  alimentation: Alimentation | null;
  densiteAnimale: DensiteAnimale | null;
};

export function ScoreCarbonPreview({
  modeElevage,
  alimentation,
  densiteAnimale,
}: ScoreCarbonPreviewProps) {
  const hasAny =
    modeElevage !== null || alimentation !== null || densiteAnimale !== null;

  return (
    <div
      aria-live="polite"
      className="rounded-xl border border-terroir-border bg-terroir-bg p-4"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-terra-700">
          Aperçu de votre fiche publique
        </p>
        {hasAny ? (
          <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-terroir-green-700">
            En direct
          </span>
        ) : null}
      </div>

      {hasAny ? (
        <div className="grid gap-3">
          <ScoreCarbonIndicators
            modeElevage={modeElevage}
            alimentation={alimentation}
            densiteAnimale={densiteAnimale}
          />
        </div>
      ) : (
        <div
          data-testid="score-carbon-preview-placeholder"
          className="rounded-lg border border-dashed border-terroir-border bg-white px-4 py-8 text-center"
        >
          <p className="text-[13px] font-medium text-terroir-ink/[0.7]">
            Sélectionnez les options ci-dessus
          </p>
          <p className="mt-1 text-[12px] text-terroir-ink/[0.55]">
            pour voir l&apos;aperçu de votre fiche publique
          </p>
        </div>
      )}
    </div>
  );
}
