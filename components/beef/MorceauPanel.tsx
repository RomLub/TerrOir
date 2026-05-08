import Link from 'next/link';
import {
  BEEF_CUTS,
  CATEGORY_TO_FAMILY,
  FAMILY_META,
  type BeefCutSlug,
} from '@/lib/beef-cuts';

export type MorceauPanelProps = {
  /** Slug selectionne. Null = empty state. */
  selectedId: BeefCutSlug | null;
  /** Callback de retour a l'empty state. */
  onClear: () => void;
};

/**
 * Panneau lateral du listing /decoupe-boeuf.
 * Empty state par defaut + active state au clic sur une zone.
 *
 * Suit la maquette decoupe_boeuf/index.html lignes 392-505.
 */
export function MorceauPanel({ selectedId, onClear }: MorceauPanelProps) {
  if (selectedId) {
    const cut = BEEF_CUTS[selectedId];
    const family = cut.family ?? CATEGORY_TO_FAMILY[cut.category];
    const familyMeta = FAMILY_META[family];
    const cuissons =
      cut.cookingDetails?.map((c) => c.label) ?? [...cut.cookingMethods];
    const lede = cut.shortLede ?? cut.shortDescription;

    return (
      <ActiveState
        cutName={cut.name}
        familyLabel={familyMeta.label}
        familyColor={familyMeta.fillColor}
        lede={lede}
        cuissons={cuissons}
        portionGrams={cut.portionGrams ?? 200}
        slug={cut.slug}
        onClear={onClear}
      />
    );
  }

  return <EmptyState />;
}

function EmptyState() {
  return (
    <div data-panel-state="empty">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-full bg-terra-100 flex items-center justify-center">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-terra-700"
            aria-hidden="true"
          >
            <path d="M9 11l3 3 8-8" />
            <path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9c1.61 0 3.13.42 4.45 1.16" />
          </svg>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] font-semibold text-terra-700">
            Mode decouverte
          </div>
          <div className="text-[13px] text-terroir-ink/65 mt-0.5">
            Cliquez sur un morceau du schema
          </div>
        </div>
      </div>

      <div className="mb-6 pb-6 border-b border-terroir-border">
        <div className="text-[12px] uppercase tracking-wider font-semibold text-terroir-ink/50 mb-3">
          Ce que vous verrez
        </div>
        <div className="space-y-2.5">
          <div className="ghost-bar h-2.5 w-1/3" />
          <div className="ghost-bar h-7 w-3/4" />
          <div className="ghost-bar h-2 w-full mt-3" />
          <div className="ghost-bar h-2 w-5/6" />
          <div className="ghost-bar h-2 w-2/3" />
          <div className="flex gap-2 mt-4">
            <div className="ghost-bar h-6 w-16 rounded-full" />
            <div className="ghost-bar h-6 w-20 rounded-full" />
            <div className="ghost-bar h-6 w-14 rounded-full" />
          </div>
        </div>
      </div>

      <div className="mb-6">
        <div className="text-[12px] uppercase tracking-wider font-semibold text-terroir-ink/50 mb-3">
          En un coup d&apos;oeil
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-terra-50 rounded-xl px-3.5 py-3">
            <div className="font-serif text-[28px] leading-none text-terra-700 tabular-nums">
              29
            </div>
            <div className="text-[11.5px] text-terroir-ink/65 mt-1">
              morceaux distincts
            </div>
          </div>
          <div className="bg-terra-50 rounded-xl px-3.5 py-3">
            <div className="font-serif text-[28px] leading-none text-terra-700 tabular-nums">
              12
            </div>
            <div className="text-[11.5px] text-terroir-ink/65 mt-1">
              eleveurs en Sarthe
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-start gap-3 p-4 rounded-xl bg-terra-50 border border-terra-100">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 mt-0.5 text-terra-700"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <div className="text-[12.5px] leading-[1.5] text-terra-900">
          <strong className="font-semibold">Astuce :</strong> les couleurs du
          schema indiquent la{' '}
          <strong className="font-semibold">famille de cuisson</strong>{' '}
          (cf. legende au-dessus du schema).
        </div>
      </div>
    </div>
  );
}

type ActiveStateProps = {
  cutName: string;
  familyLabel: string;
  familyColor: string;
  lede: string;
  cuissons: readonly string[];
  portionGrams: number;
  slug: BeefCutSlug;
  onClear: () => void;
};

function ActiveState({
  cutName,
  familyLabel,
  familyColor,
  lede,
  cuissons,
  portionGrams,
  slug,
  onClear,
}: ActiveStateProps) {
  return (
    <div data-panel-state="active">
      <button
        type="button"
        onClick={onClear}
        className="text-[12.5px] text-terroir-ink/55 hover:text-terra-700 transition-colors flex items-center gap-1.5 mb-5"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="19" y1="12" x2="5" y2="12" />
          <polyline points="12 19 5 12 12 5" />
        </svg>
        Voir tous les morceaux
      </button>

      <div
        className="text-[11px] uppercase tracking-[0.18em] font-semibold mb-2"
        style={{ color: familyColor }}
      >
        {familyLabel}
      </div>
      <h2 className="font-serif text-[36px] leading-[1.05] font-medium tracking-tight text-terroir-ink">
        {cutName}
      </h2>
      <p className="mt-3 text-[15px] leading-[1.55] text-terroir-ink/75">
        {lede}
      </p>

      {cuissons.length > 0 && (
        <div className="mt-5">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-terroir-ink/50 mb-2">
            Cuissons
          </div>
          <div className="flex flex-wrap gap-1.5">
            {cuissons.map((cuisson) => (
              <span
                key={cuisson}
                className="px-2.5 py-1 rounded-full bg-terra-100 text-terra-900 text-[12px] font-medium"
              >
                {cuisson}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5">
        <div className="bg-terra-50 rounded-xl px-3.5 py-3">
          <div className="text-[11px] text-terroir-ink/55 uppercase tracking-wider font-semibold">
            Compter
          </div>
          <div className="font-semibold text-[14px] mt-1 leading-tight tabular-nums">
            {portionGrams}{' '}
            <span className="text-terroir-ink/55 font-normal">g/pers</span>
          </div>
        </div>
      </div>

      <Link
        href="/producteurs"
        className="mt-6 block bg-green-700 hover:bg-green-900 transition-colors text-white rounded-2xl px-5 py-4 focus:outline-none focus:ring-2 focus:ring-green-700 focus:ring-offset-2 focus:ring-offset-terroir-bg"
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wider font-semibold opacity-80">
              En Sarthe
            </div>
            <div className="font-medium text-[15px] mt-0.5">
              Voir nos producteurs
            </div>
          </div>
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </div>
      </Link>

      <Link
        href={`/decoupe-boeuf/${slug}`}
        className="mt-3 block text-center border border-terra-700 text-terra-700 rounded-2xl px-5 py-3 text-[14px] font-medium hover:bg-terra-50 transition-colors focus:outline-none focus:ring-2 focus:ring-terra-700 focus:ring-offset-2 focus:ring-offset-terroir-bg"
      >
        Tout savoir sur ce morceau →
      </Link>
    </div>
  );
}
