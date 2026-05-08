'use client';

import { useEffect, useRef } from 'react';
import { ALL_CUT_SLUGS, BEEF_CUTS, type BeefCutSlug } from '@/lib/beef-cuts';

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

export type CowSchemaInteractiveProps = {
  /** Markup SVG inline V2 (loadCowSvgV2 cote serveur). */
  svgMarkup: string;
  /** Slug actuellement selectionne (pilote l'etat selected/dim). */
  selectedId: BeefCutSlug | null;
  /** Callback de selection — la page parente ouvre/met a jour le panneau. */
  onSelect: (slug: BeefCutSlug) => void;
};

/**
 * Schema interactif V2. Pas de redirection automatique — au clic, on
 * appelle onSelect(slug) et le panneau parent se met a jour.
 *
 * Differences vs V1 (CowDiagram) :
 * - Selection in-place (callback) plutot que router.push
 * - Etat selected pilote par prop (selectedId) plutot que state interne
 * - Pas de panneau lateral integre (delegue a MorceauPanel parent)
 * - Couleurs des morceaux par famille (data-cat post-processe serveur)
 * - Dim des autres morceaux quand selection active (.has-selection)
 */
export function CowSchemaInteractive({
  svgMarkup,
  selectedId,
  onSelect,
}: CowSchemaInteractiveProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  // A11y : pose role/tabIndex/aria-label sur les paths au mount.
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

  // Sync selection : applique data-selected + has-selection sur le wrapper SVG.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const svg = wrapper.querySelector('svg');
    if (!svg) return;

    if (selectedId) {
      svg.setAttribute('data-has-selection', 'true');
    } else {
      svg.removeAttribute('data-has-selection');
    }

    const paths = wrapper.querySelectorAll<SVGPathElement>('path[data-cut]');
    paths.forEach((path) => {
      const slug = path.getAttribute('data-cut');
      if (slug === selectedId) {
        path.setAttribute('data-selected', 'true');
        path.setAttribute('aria-selected', 'true');
      } else {
        path.removeAttribute('data-selected');
        path.removeAttribute('aria-selected');
      }
    });
  }, [selectedId]);

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const slug = findCutTarget(event.target);
    if (slug) onSelect(slug);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const slug = findCutTarget(event.target);
    if (!slug) return;
    event.preventDefault();
    onSelect(slug);
  };

  return (
    <div
      ref={wrapperRef}
      className="cow-schema cow-schema--interactive"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      dangerouslySetInnerHTML={{ __html: svgMarkup }}
    />
  );
}
