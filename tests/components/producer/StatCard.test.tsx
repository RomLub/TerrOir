// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatCard } from '@/components/producer/StatCard';

describe('StatCard — contrat d\'alignement et palette', () => {
  it('rend les 3 zones (label, value, sub) avec leurs classes canoniques', () => {
    const html = renderToStaticMarkup(
      <StatCard label="Commandes" value="42" sub="+5 depuis hier" />,
    );
    expect(html).toContain('Commandes');
    expect(html).toContain('42');
    expect(html).toContain('+5 depuis hier');
    // Zone label : line-clamp-2 + min-h pour réserver 2 lignes
    expect(html).toContain('line-clamp-2');
    expect(html).toContain('min-h-[2.6em]');
    // Zone value : truncate + font-serif + text-[36px]
    expect(html).toContain('truncate');
    expect(html).toContain('font-serif');
    expect(html).toContain('text-[36px]');
    // Zone sub : line-clamp-1 + min-h pour réserver 1 ligne
    expect(html).toContain('line-clamp-1');
    expect(html).toContain('min-h-[1.4em]');
  });

  it('tone par défaut = green (text-green-900 sur la valeur)', () => {
    const html = renderToStaticMarkup(
      <StatCard label="X" value="0" sub="—" />,
    );
    expect(html).toContain('text-green-900');
    expect(html).not.toContain('text-terra-700');
  });

  it('tone=terra applique text-terra-700 sur la valeur', () => {
    const html = renderToStaticMarkup(
      <StatCard label="X" value="0" sub="—" tone="terra" />,
    );
    expect(html).toContain('text-terra-700');
    expect(html).not.toContain('text-green-900');
  });

  it('sub absent : zone sub rendue avec un NBSP placeholder pour préserver la hauteur', () => {
    const html = renderToStaticMarkup(<StatCard label="X" value="0" />);
    // La zone sub doit être présente même sans contenu (min-h + line-clamp préservés)
    expect(html).toContain('min-h-[1.4em]');
    expect(html).toContain('line-clamp-1');
    // Le placeholder NBSP (U+00A0) doit être rendu pour donner du contenu au line-clamp
    expect(html).toContain('\u00A0');
  });

  it('label long : line-clamp-2 et min-h restent appliqués (alignement préservé)', () => {
    const longLabel =
      'Un label tres tres long qui depasserait largement la largeur dune carte etroite et devrait normalement wrap';
    const html = renderToStaticMarkup(
      <StatCard label={longLabel} value="0" sub="x" />,
    );
    expect(html).toContain(longLabel);
    expect(html).toContain('line-clamp-2');
    expect(html).toContain('min-h-[2.6em]');
  });

  it('value accepte un ReactNode (pas seulement string/number)', () => {
    const html = renderToStaticMarkup(
      <StatCard
        label="X"
        value={
          <span data-testid="custom-value">
            4,8 <em>etoile</em>
          </span>
        }
        sub="2 avis"
      />,
    );
    expect(html).toContain('data-testid="custom-value"');
    expect(html).toContain('4,8');
    expect(html).toContain('<em>etoile</em>');
  });
});
