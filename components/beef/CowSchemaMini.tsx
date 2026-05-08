import type { BeefCutSlug } from '@/lib/beef-cuts';

export type CowSchemaMiniProps = {
  /** Markup SVG V2 charge cote serveur (loadCowSvgV2). */
  svgMarkup: string;
  /** Slug a mettre en surbrillance plein. */
  slug: BeefCutSlug;
};

/**
 * Schema mini illustratif pour la page detail. Pas d'interactivite.
 * Toutes les zones gardent leur couleur de famille (data-cat) avec
 * opacite 0.32, sauf la zone cible qui passe a opacite 1 + stroke ink
 * fort. La logique de styling vit dans .cow-schema--mini (globals.css).
 *
 * Server component — post-processe le markup pour injecter
 * data-highlighted="true" sur le path cible.
 */
export function CowSchemaMini({ svgMarkup, slug }: CowSchemaMiniProps) {
  const needle = `data-cut="${slug}"`;
  const replacement = `${needle} data-highlighted="true"`;
  const processedMarkup = svgMarkup.includes(needle)
    ? svgMarkup.replace(needle, replacement)
    : svgMarkup;

  return (
    <div
      className="cow-schema cow-schema--mini"
      dangerouslySetInnerHTML={{ __html: processedMarkup }}
    />
  );
}
