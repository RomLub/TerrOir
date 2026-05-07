import type { BeefCutSlug } from '@/lib/beef-cuts';

export type CowDiagramMiniProps = {
  /** Markup SVG inline (charge cote serveur depuis public/images/cow.svg). */
  svgMarkup: string;
  /** Slug du morceau a mettre en surbrillance plein. */
  slug: BeefCutSlug;
};

/**
 * Schema anatomique compact, purement illustratif.
 *
 * Aucune interactivite : tous les paths data-cut sont passes en
 * pointer-events: none via la classe parente cow-diagram--static (cf.
 * app/globals.css). Le morceau cible recoit data-highlighted="true"
 * qui declenche le fill terra-500 a 70%.
 */
export function CowDiagramMini({ svgMarkup, slug }: CowDiagramMiniProps) {
  // Injection du flag de highlight cote serveur. On cherche le path
  // exact via son attribut data-cut="<slug>" et on insere
  // data-highlighted="true" au meme niveau d'attribut. Si le slug
  // n'existe pas dans le SVG (impossible vu generateStaticParams +
  // ALL_CUT_SLUGS), aucun replacement n'est fait, le mini-svg s'affiche
  // sans highlight.
  const needle = `data-cut="${slug}"`;
  const replacement = `${needle} data-highlighted="true"`;
  const processedMarkup = svgMarkup.includes(needle)
    ? svgMarkup.replace(needle, replacement)
    : svgMarkup;

  return (
    <figure className="cow-diagram cow-diagram--static cow-diagram--mini">
      <div
        className="cow-diagram__svg"
        dangerouslySetInnerHTML={{ __html: processedMarkup }}
      />
      <figcaption className="mt-3 text-center text-[12px] text-dark/60 uppercase tracking-wider">
        Localisation du morceau
      </figcaption>
    </figure>
  );
}
