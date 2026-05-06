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

// Source unique des 3 IndicatorCard score carbone (mode_elevage, alimentation,
// densité animale). Partagé entre la fiche publique consumer
// (ScoreCarbonBlock) et l'aperçu producteur live (ScoreCarbonPreview, T-212).
// Permet d'éviter toute divergence visuelle entre "comment c'est rendu" et
// "comment ça apparaîtra" : une seule source pour les pills, tons couleurs et
// hints. Le wrapper grid/stack reste à la charge de l'appellant.

export const DENSITE_TONE: Record<DensiteAnimale, string> = {
  extensive: "bg-terroir-green-100 text-terroir-green-700",
  standard: "bg-terroir-terra-100 text-terroir-terra-700",
  intensive: "bg-orange-100 text-orange-700",
};

export const MODE_ELEVAGE_TONE = "bg-terroir-green-100 text-terroir-green-700";
export const ALIMENTATION_TONE = "bg-terroir-terra-100 text-terroir-terra-700";

export function IndicatorCard({
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

export function ScoreCarbonIndicators({
  modeElevage,
  alimentation,
  densiteAnimale,
}: {
  modeElevage: ModeElevage | null;
  alimentation: Alimentation | null;
  densiteAnimale: DensiteAnimale | null;
}) {
  return (
    <>
      {modeElevage !== null && (
        <IndicatorCard
          eyebrow="Mode d'élevage"
          label={MODE_ELEVAGE_PUBLIC_LABELS[modeElevage]}
          hint={MODE_ELEVAGE_HINTS[modeElevage]}
          pillClass={MODE_ELEVAGE_TONE}
        />
      )}
      {alimentation !== null && (
        <IndicatorCard
          eyebrow="Alimentation"
          label={ALIMENTATION_PUBLIC_LABELS[alimentation]}
          hint={ALIMENTATION_HINTS[alimentation]}
          pillClass={ALIMENTATION_TONE}
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
    </>
  );
}
