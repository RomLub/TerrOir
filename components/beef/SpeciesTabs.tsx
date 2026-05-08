type Species = {
  id: string;
  label: string;
  active: boolean;
  href?: string;
};

const SPECIES: readonly Species[] = [
  { id: 'boeuf', label: 'Boeuf', active: true, href: '/decoupe-boeuf' },
  { id: 'porc', label: 'Porc', active: false },
  { id: 'agneau', label: 'Agneau', active: false },
  { id: 'volaille', label: 'Volaille', active: false },
];

/**
 * Onglets espece pour la page decoupe.
 * Boeuf est actif (V1). Les 3 autres restent en disabled avec badge
 * "Bientot" pour signaler la roadmap au visiteur (cf. HANDOFF Claude
 * Design : "présents en disabled dès la V1").
 */
export function SpeciesTabs() {
  return (
    <div
      className="mb-6 flex items-center gap-1.5 border-b border-terroir-border"
      role="tablist"
      aria-label="Especes"
    >
      {SPECIES.map((species) => {
        if (species.active) {
          return (
            <button
              key={species.id}
              type="button"
              role="tab"
              aria-selected="true"
              className="px-5 h-11 inline-flex items-center gap-2 rounded-t-xl bg-terra-700 text-white font-medium text-[14px] -mb-px"
            >
              {species.label}
            </button>
          );
        }
        return (
          <button
            key={species.id}
            type="button"
            role="tab"
            aria-selected="false"
            aria-disabled="true"
            disabled
            className="px-5 h-11 inline-flex items-center gap-2 text-terroir-ink/55 hover:text-terroir-ink/80 transition-colors font-medium text-[14px] cursor-not-allowed"
            title={`${species.label} : bientot disponible`}
          >
            {species.label}
            <span className="text-[9.5px] tracking-[0.14em] uppercase font-semibold text-terroir-ink/40 px-1.5 py-0.5 rounded bg-terroir-border/60">
              Bientot
            </span>
          </button>
        );
      })}
    </div>
  );
}
