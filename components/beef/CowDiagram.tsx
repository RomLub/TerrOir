'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ALL_CUT_SLUGS,
  BEEF_CUTS,
  CATEGORY_META,
  type BeefCutSlug,
} from '@/lib/beef-cuts';

const CUT_SLUG_SET: ReadonlySet<string> = new Set(ALL_CUT_SLUGS);

function isCutSlug(value: string | null | undefined): value is BeefCutSlug {
  return !!value && CUT_SLUG_SET.has(value);
}

function findCutTarget(target: EventTarget | null): BeefCutSlug | null {
  if (!(target instanceof Element)) return null;
  const path = target.closest<HTMLElement>('[data-cut]');
  if (!path) return null;
  const slug = path.getAttribute('data-cut');
  return isCutSlug(slug) ? slug : null;
}

export type CowDiagramProps = {
  /** Markup SVG inline (chargé côté serveur depuis public/images/cow.svg). */
  svgMarkup: string;
  /** Slug à afficher en surbrillance permanente (ex. page détail morceau). */
  highlightedCut?: BeefCutSlug;
  /**
   * Liste blanche des morceaux disponibles (préparation Supabase).
   * Pour l'instant, mocké à ALL_CUT_SLUGS. Quand la table products
   * exposera un compteur de stock par cut, brancher ici la query
   * `select cut_slug from products where stock > 0 group by cut_slug`
   * et passer le résultat en prop.
   */
  availableCuts?: readonly BeefCutSlug[];
  /**
   * Affiche ou non le panneau latéral d'info au survol. Désactivé sur
   * les pages détail où l'info est déjà rendue dans la page elle-même.
   */
  showPanel?: boolean;
};

/**
 * Schéma anatomique interactif des morceaux du bœuf.
 *
 * Le SVG est injecté tel quel via dangerouslySetInnerHTML (pas de conversion
 * JSX nécessaire). Les paths du calque "Zones" portent un attribut
 * data-cut="<slug>" exploité par délégation d'événements au niveau du
 * wrapper. La structure SVG reste donc inchangée et reste compatible avec
 * une régénération graphique ultérieure.
 */
export function CowDiagram({
  svgMarkup,
  highlightedCut,
  availableCuts = ALL_CUT_SLUGS,
  showPanel = true,
}: CowDiagramProps) {
  const router = useRouter();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<BeefCutSlug | null>(null);

  const availableSet = useMemo(() => new Set(availableCuts), [availableCuts]);

  // Au mount : injecter les attributs a11y sur les paths interactifs
  // (role/tabIndex/aria-label). Ces attributs ne peuvent pas être posés
  // statiquement dans le SVG sans alourdir le markup ; on les pose ici
  // une seule fois.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const paths = wrapper.querySelectorAll<SVGPathElement>('path[data-cut]');
    paths.forEach((path) => {
      const slug = path.getAttribute('data-cut');
      if (!isCutSlug(slug)) return;
      const cut = BEEF_CUTS[slug];
      path.setAttribute('role', 'button');
      path.setAttribute('tabindex', '0');
      path.setAttribute('aria-label', cut.name);
    });
  }, [svgMarkup]);

  // Sync attribut data-highlighted (pour CSS) avec la prop highlightedCut.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const paths = wrapper.querySelectorAll<SVGPathElement>('path[data-cut]');
    paths.forEach((path) => {
      const slug = path.getAttribute('data-cut');
      if (slug === highlightedCut) {
        path.setAttribute('data-highlighted', 'true');
      } else {
        path.removeAttribute('data-highlighted');
      }
    });
  }, [highlightedCut]);

  const navigate = (slug: BeefCutSlug) => {
    if (!availableSet.has(slug)) return;
    router.push(`/decoupe-boeuf/${slug}`);
  };

  const handleMouseOver = (event: React.MouseEvent<HTMLDivElement>) => {
    const slug = findCutTarget(event.target);
    if (slug && slug !== hovered) {
      setHovered(slug);
    }
  };

  const handleMouseLeave = () => setHovered(null);

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const slug = findCutTarget(event.target);
    if (slug) navigate(slug);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const slug = findCutTarget(event.target);
    if (!slug) return;
    event.preventDefault();
    navigate(slug);
  };

  const hoveredCut = hovered ? BEEF_CUTS[hovered] : null;
  const fallbackCut = highlightedCut ? BEEF_CUTS[highlightedCut] : null;
  const displayed = hoveredCut ?? fallbackCut;

  const containerClass = showPanel
    ? 'cow-diagram grid gap-6 md:grid-cols-[2fr_1fr] md:items-start'
    : 'cow-diagram';

  return (
    <div className={containerClass}>
      <div
        ref={wrapperRef}
        className="cow-diagram__svg w-full"
        onMouseOver={handleMouseOver}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        dangerouslySetInnerHTML={{ __html: svgMarkup }}
      />

      {showPanel && (
        <aside
          role="status"
          aria-live="polite"
          className="cow-diagram__panel sticky top-24 rounded-2xl border border-terroir-border bg-white/80 p-5 shadow-soft"
        >
          {displayed ? (
            <div>
              <span
                className="inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white"
                style={{
                  backgroundColor: CATEGORY_META[displayed.category].fillColor,
                }}
              >
                {CATEGORY_META[displayed.category].shortLabel}
              </span>
              <h2 className="mt-3 font-serif text-2xl text-green-900 leading-tight">
                {displayed.name}
              </h2>
              <p className="mt-2 text-sm text-dark/75 leading-relaxed">
                {displayed.shortDescription}
              </p>
              <p className="mt-4 text-xs uppercase tracking-wider text-terra-700 font-semibold">
                Cliquez pour en savoir plus
              </p>
            </div>
          ) : (
            <p className="text-sm text-dark/60">
              Survolez un morceau du schéma pour découvrir sa description.
            </p>
          )}
        </aside>
      )}
    </div>
  );
}
