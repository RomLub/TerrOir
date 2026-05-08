import type { Metadata } from 'next';
import Link from 'next/link';
import { CowDiagram } from '@/components/beef/CowDiagram';
import { loadCowSvg } from '@/lib/beef/load-cow-svg';
import {
  CATEGORY_META,
  getCutsByCategory,
  type BeefCutCategory,
} from '@/lib/beef-cuts';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Les morceaux du bœuf | TerrOir',
  description:
    "Schéma interactif de la découpe du bœuf à la française. Survolez la silhouette pour découvrir chaque morceau, son usage et ses cuissons recommandées.",
};

const CATEGORY_ORDER: readonly BeefCutCategory[] = [
  'noble',
  'piece-du-boucher',
  'polyvalent',
  'a-mijoter',
  'abat-extremite',
];

export default async function DecoupeBoeufPage() {
  const svgMarkup = await loadCowSvg();

  return (
    <div className="bg-bg">
      <section className="max-w-5xl mx-auto px-6 pt-16 pb-10 text-center">
        <span className="text-[11px] uppercase tracking-[0.2em] text-terra-700 font-semibold">
          Découverte
        </span>
        <h1 className="mt-3 font-serif text-[40px] md:text-[56px] text-green-900 leading-[1.05] tracking-tight">
          Comprendre les morceaux du bœuf
        </h1>
        <p className="mt-5 text-[16px] text-dark/70 max-w-2xl mx-auto leading-relaxed">
          La découpe française compte une trentaine de morceaux, chacun avec sa
          texture, son usage culinaire et son temps de cuisson idéal. Survolez
          le schéma pour explorer.
        </p>
      </section>

      <section className="max-w-7xl mx-auto px-6 pb-16">
        <CowDiagram svgMarkup={svgMarkup} />
      </section>

      <section className="max-w-7xl mx-auto px-6 pb-16">
        <h2 className="font-serif text-[32px] text-green-900 leading-tight">
          Les catégories
        </h2>
        <p className="mt-2 text-[15px] text-dark/70 max-w-2xl">
          Cinq familles regroupent les morceaux selon leur tendreté et leur
          mode de cuisson dominant.
        </p>

        <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {CATEGORY_ORDER.map((category) => {
            const meta = CATEGORY_META[category];
            const cuts = getCutsByCategory(category);
            return (
              <article
                key={category}
                className="rounded-2xl border border-terroir-border bg-white p-6 shadow-soft"
              >
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="inline-block size-4 rounded-full"
                    style={{ backgroundColor: meta.fillColor }}
                  />
                  <h3 className="font-serif text-[22px] text-green-900">
                    {meta.label}
                  </h3>
                </div>
                <p className="mt-3 text-[14px] text-dark/70 leading-relaxed">
                  {meta.description}
                </p>
                <ul className="mt-4 flex flex-wrap gap-2">
                  {cuts.map((cut) => (
                    <li key={cut.slug}>
                      <Link
                        href={`/decoupe-boeuf/${cut.slug}`}
                        className="inline-flex items-center rounded-full border border-terra-200 bg-terra-50 px-3 py-1 text-[13px] text-terra-700 hover:bg-terra-100 hover:border-terra-700 focus:outline-none focus:ring-2 focus:ring-terra-700 transition-colors"
                      >
                        {cut.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
      </section>

      <footer className="max-w-7xl mx-auto px-6 pb-16">
        <p className="text-[12px] text-dark/50 leading-relaxed">
          Schéma anatomique adapté de{' '}
          <a
            href="https://commons.wikimedia.org/wiki/File:Beef_cuts_France.svg"
            target="_blank"
            rel="noreferrer noopener"
            className="underline hover:text-dark/70"
          >
            Beef cuts France
          </a>{' '}
          sur Wikimedia Commons, sous licence{' '}
          <a
            href="https://creativecommons.org/licenses/by-sa/3.0/"
            target="_blank"
            rel="noreferrer noopener"
            className="underline hover:text-dark/70"
          >
            CC-BY-SA 3.0
          </a>
          .
        </p>
      </footer>
    </div>
  );
}
