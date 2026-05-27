import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MAX_WEEK_OFFSET, MIN_WEEK_OFFSET } from '@/lib/dates/week-navigation';

// WeekNavigator lit usePathname() + useSearchParams() de next/navigation et
// rend des <Link> (pas d'état React, pas de jsdom requis). On mocke le router
// pour piloter le pathname et les params courants.

let currentPathname = '/dashboard';
let currentParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  usePathname: () => currentPathname,
  useSearchParams: () => currentParams,
  // `useRouter` est consommé par le composant pour la navigation
  // interceptée (clic intercepté + startTransition). Inutile en SSR pur
  // mais l'export doit exister à l'import du module.
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

import { WeekNavigator } from '@/app/(producer)/_components/WeekNavigator';

// Rend via React (et non via un appel direct de la fonction composant) pour
// que les hooks React (dont `useTransition`) disposent du dispatcher SSR.
function render(props: { weekOffset: number; periodLabel: string }): string {
  return renderToStaticMarkup(createElement(WeekNavigator, props));
}

// Extrait l'attribut href du <a> dont le aria-label matche.
function hrefForLabel(html: string, ariaLabel: string): string | null {
  const labelIdx = html.indexOf(`aria-label="${ariaLabel}"`);
  if (labelIdx === -1) return null;
  const tagStart = html.lastIndexOf('<a', labelIdx);
  const tagEnd = html.indexOf('>', labelIdx);
  if (tagStart === -1 || tagEnd === -1) return null;
  const tag = html.substring(tagStart, tagEnd + 1);
  const m = tag.match(/href="([^"]*)"/);
  return m ? m[1]! : null;
}

beforeEach(() => {
  currentPathname = '/dashboard';
  currentParams = new URLSearchParams();
});

describe('WeekNavigator', () => {
  it('offset 0 : prev pointe sur week=-1, next supprime le param (semaine courante)', () => {
    const html = render({ weekOffset: 0, periodLabel: '18 – 24 mai' });
    expect(hrefForLabel(html, 'Semaine précédente')).toBe('/dashboard?week=-1');
    expect(hrefForLabel(html, 'Semaine suivante')).toBe('/dashboard?week=1');
  });

  it('affiche le libellé de période', () => {
    const html = render({ weekOffset: 0, periodLabel: '18 – 24 mai' });
    expect(html).toContain('18 – 24 mai');
  });

  it('offset 0 : pas de lien « revenir à cette semaine », mention « Cette semaine »', () => {
    const html = render({ weekOffset: 0, periodLabel: '18 – 24 mai' });
    expect(html).toContain('Cette semaine');
    expect(html).not.toContain('Revenir à cette semaine');
  });

  it('offset négatif : next remonte vers 0 et supprime le param', () => {
    const html = render({ weekOffset: -1, periodLabel: '11 – 17 mai' });
    expect(hrefForLabel(html, 'Semaine précédente')).toBe('/dashboard?week=-2');
    // next offset = 0 → param supprimé.
    expect(hrefForLabel(html, 'Semaine suivante')).toBe('/dashboard');
  });

  it('offset non nul : lien « Revenir à cette semaine » présent', () => {
    const html = render({ weekOffset: -2, periodLabel: '4 – 10 mai' });
    expect(html).toContain('Revenir à cette semaine');
    expect(html).toContain('href="/dashboard"');
  });

  it('préserve les autres query params', () => {
    currentParams = new URLSearchParams('foo=bar&cursor=abc');
    const html = render({ weekOffset: 1, periodLabel: '25 – 31 mai' });
    const prev = hrefForLabel(html, 'Semaine précédente');
    // prev offset = 0 → week retiré, foo + cursor conservés.
    expect(prev).toContain('foo=bar');
    expect(prev).toContain('cursor=abc');
    expect(prev).not.toContain('week=');

    const next = hrefForLabel(html, 'Semaine suivante');
    expect(next).toContain('week=2');
    expect(next).toContain('foo=bar');
  });

  it('borne basse : à MIN_WEEK_OFFSET, pas de lien « précédente » (désactivé)', () => {
    const html = render({ weekOffset: MIN_WEEK_OFFSET, periodLabel: 'X' });
    // Flèche précédente rendue comme <span aria-hidden>, pas un <a>.
    expect(hrefForLabel(html, 'Semaine précédente')).toBeNull();
    // La flèche suivante reste cliquable.
    expect(hrefForLabel(html, 'Semaine suivante')).not.toBeNull();
  });

  it('borne haute : à MAX_WEEK_OFFSET, pas de lien « suivante » (désactivé)', () => {
    const html = render({ weekOffset: MAX_WEEK_OFFSET, periodLabel: 'X' });
    expect(hrefForLabel(html, 'Semaine suivante')).toBeNull();
    expect(hrefForLabel(html, 'Semaine précédente')).not.toBeNull();
  });

  it('respecte le pathname courant (revenus)', () => {
    currentPathname = '/revenus';
    const html = render({ weekOffset: 0, periodLabel: '18 – 24 mai' });
    expect(hrefForLabel(html, 'Semaine précédente')).toBe('/revenus?week=-1');
  });
});
