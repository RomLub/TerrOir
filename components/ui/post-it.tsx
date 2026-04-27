// Post-it « Conseil de l'éleveur » — élément signature TerrOir.
//
// Variant statique pour la home (section "Map + Conseil"). Pour la fiche
// produit, prévoir Phase 2 le pattern trigger + popover documenté dans
// design_system_cards/component-postit.html (icône amber-500 cliquable
// → popover 320px modal mobile bottom sheet).
//
// Style fidèle au screen handoff (screens/desktop/homepage.css L148-156) :
//   - fond #FFF7D6 (token postit.bg) + border amber-200/60
//   - radius 12px (rounded-xl)
//   - rotate(-1.4deg) pour l'effet "collé un peu de travers"
//   - shadow-lift teintée verte (cohérent screens, pas terra contrairement
//     à 00_DESIGN_SYSTEM.md textuel — incohérence interne tranchée côté
//     screens validés visuellement)
//   - pseudo-élément scotch terra rgba(160,82,45,.18) en haut

export type PostItProps = {
  /** Eyebrow uppercase, typiquement "Le conseil de {prénom}". */
  eyebrow: string;
  /** Citation courte, italique Cormorant (le composant ajoute les guillemets « »). */
  quote: string;
  /** Signature après tiret cadratin, ex: "Marie" → rendu "— Marie" en Caveat manuscrit. */
  signature: string;
  /** Métadonnée fine sous la signature, ex: "Ferme des Tilleuls · Coulaines". */
  meta?: string;
  className?: string;
};

export function PostIt({
  eyebrow,
  quote,
  signature,
  meta,
  className = "",
}: PostItProps) {
  return (
    <div
      className={`relative rounded-xl border border-postit-border/60 bg-postit-bg p-6 shadow-lift before:absolute before:left-8 before:top-[-10px] before:h-6 before:w-20 before:rounded-sm before:bg-terra-700/[0.18] before:[transform:rotate(-3deg)] before:content-[''] ${className}`}
      style={{ transform: "rotate(-1.4deg)" }}
    >
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-terra-700">
        {eyebrow}
      </span>
      <p className="mt-3 font-serif text-[21px] font-medium italic leading-[1.5] text-terroir-ink/[0.88]">
        «&nbsp;{quote}&nbsp;»
      </p>
      <div className="mt-4 text-right font-hand text-[24px] font-medium leading-none text-green-900">
        — {signature}
      </div>
      {meta ? (
        <div className="mt-1 text-right text-[13px] leading-[1.4] text-terroir-muted">
          {meta}
        </div>
      ) : null}
    </div>
  );
}
