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
//
// T-215 a11y :
//   - DENSITE_TONE est le seul cas où la couleur porte une connotation
//     positive/négative (extensive=bien-être, intensive=peu d'espace) ;
//     on ajoute un picto non-couleur pour ne pas perdre l'info chez un
//     utilisateur dichromat. Pas d'icône sur MODE_ELEVAGE ni ALIMENTATION
//     (couleur identique pour toutes les valeurs, l'info passe par le
//     texte uniquement — aucun risque WCAG 1.4.1 "use of color").
//   - aria-label enrichi sur chaque pill : "<eyebrow> : <label>" pour la
//     lecture screen reader sortie de contexte. Le hint reste lu en DOM
//     order via la balise <p> sous la pill (déjà accessible).
//   - Contraste vérifié WCAG AA texte normal (≥ 4.5:1) pour les 3 tons :
//     vert ≈ 5.6:1, terra ≈ 4.6:1, orange ≈ 4.5:1. Cf.
//     docs/fixes/score-carbon-a11y-2026-05-06.md pour détail des calculs.

export const DENSITE_TONE: Record<DensiteAnimale, string> = {
  extensive: "bg-terroir-green-100 text-terroir-green-700",
  standard: "bg-terroir-terra-100 text-terroir-terra-700",
  intensive: "bg-orange-100 text-orange-700",
};

export const MODE_ELEVAGE_TONE = "bg-terroir-green-100 text-terroir-green-700";
export const ALIMENTATION_TONE = "bg-terroir-terra-100 text-terroir-terra-700";

// T-215 — Picto non-couleur par valeur de densité. SVG inline 12px aligné
// vertical avec le texte de la pill ; aria-hidden car la sémantique est
// déjà portée par le texte de la pill + le hint en clair.
function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 8.5 L7 12 L13 4.5" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
    >
      <path d="M3.5 8 L12.5 8" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 3 L14 13 L2 13 Z" />
      <path d="M8 7 L8 10" />
      <circle cx="8" cy="11.6" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export const DENSITE_ICON: Record<DensiteAnimale, JSX.Element> = {
  extensive: <CheckIcon />,
  standard: <MinusIcon />,
  intensive: <WarningIcon />,
};

export function IndicatorCard({
  eyebrow,
  label,
  hint,
  pillClass,
  pillIcon,
}: {
  eyebrow: string;
  label: string;
  hint: string;
  pillClass: string;
  // T-215 : picto non-couleur facultatif (utilisé pour DENSITE_TONE).
  pillIcon?: JSX.Element;
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
          aria-label={`${eyebrow} : ${label}`}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium ${pillClass}`}
        >
          {pillIcon}
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
          pillIcon={DENSITE_ICON[densiteAnimale]}
        />
      )}
    </>
  );
}
