// Disclaimer juridique — wording validé brief Phase C, transparent sur le
// caractère placeholder des chiffres affichés. À mettre à jour avec
// validation avocat avant ouverture publique de la marketplace.
//
// Style discret : fond terroir-bg, bordure top, max-w-3xl centré, text-xs
// muted (pattern footer disclaimers). Pas de eyebrow / H2 — c'est une note
// de bas de page éditoriale.

export type DisclaimerProps = { className?: string };

export function Disclaimer({ className = "" }: DisclaimerProps) {
  return (
    <section
      className={`border-t border-terroir-border bg-terroir-bg ${className}`}
      aria-labelledby="disclaimer-heading"
    >
      <div className="mx-auto max-w-3xl px-4 py-12 md:py-14">
        <h2
          id="disclaimer-heading"
          className="text-[11px] font-semibold uppercase tracking-[0.18em] text-terroir-muted"
        >
          Note méthodologique
        </h2>
        <p className="mt-3 text-xs leading-[1.65] text-terroir-ink/[0.65] md:text-sm md:leading-[1.7]">
          Les chiffres présentés sur cette page sont des ordres de grandeur
          pédagogiques destinés à illustrer la différence entre circuit court
          et grande distribution. La répartition par maillon (graphique
          ci-dessus) repose sur une représentation simplifiée d&apos;une
          réalité économique complexe et n&apos;a pas été auditée. Sources de
          référence consultées : FranceAgriMer (OFPM — Observatoire de la
          Formation des Prix et des Marges), Idele (Institut de l&apos;Élevage),
          CGAAER. Cette page sera mise à jour avec des chiffres calibrés et
          validés juridiquement avant l&apos;ouverture publique de la
          marketplace.
        </p>
      </div>
    </section>
  );
}
