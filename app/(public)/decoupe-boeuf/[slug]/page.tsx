import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import Script from 'next/script';
import { notFound } from 'next/navigation';
import { CowDiagramMini } from '@/components/beef/CowDiagramMini';
import { loadCowSvg } from '@/lib/beef/load-cow-svg';
import {
  ALL_CUT_SLUGS,
  CATEGORY_META,
  getCutBySlug,
  type BeefCutSlug,
} from '@/lib/beef-cuts';

export const dynamic = 'force-static';

type Params = { slug: string };

export function generateStaticParams(): Params[] {
  return ALL_CUT_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const cut = getCutBySlug(slug);
  if (!cut) {
    return {
      title: 'Morceau introuvable | TerrOir',
    };
  }
  return {
    title: `${cut.name} — Morceau du bœuf | TerrOir`,
    description: cut.shortDescription,
  };
}

export default async function CutDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const cut = getCutBySlug(slug);
  if (!cut) notFound();

  const meta = CATEGORY_META[cut.category];
  const svgMarkup = await loadCowSvg();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: `${cut.name} — Morceau du bœuf`,
    description: cut.shortDescription,
    articleSection: meta.label,
    inLanguage: 'fr-FR',
    isPartOf: {
      '@type': 'WebSite',
      name: 'TerrOir',
    },
    about: {
      '@type': 'Thing',
      name: cut.name,
    },
  };

  return (
    <div className="bg-bg">
      <article className="max-w-7xl mx-auto px-6 py-12">
        <nav className="mb-8 text-[13px] text-dark/60">
          <Link
            href="/decoupe-boeuf"
            className="underline hover:text-dark/80 focus:outline-none focus:ring-2 focus:ring-terra-700 rounded"
          >
            ← Voir tous les morceaux
          </Link>
        </nav>

        <div className="grid gap-10 md:grid-cols-[3fr_2fr] md:items-start">
          <header className="md:col-span-2">
            <span
              className="inline-block rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-white"
              style={{ backgroundColor: meta.fillColor }}
            >
              {meta.label}
            </span>
            <h1 className="mt-3 font-serif text-[44px] md:text-[56px] text-green-900 leading-[1.05] tracking-tight">
              {cut.name}
            </h1>
            <p className="mt-4 text-[17px] text-dark/75 max-w-2xl leading-relaxed">
              {cut.shortDescription}
            </p>
          </header>

          <section className="space-y-8">
            <div>
              <p className="text-[16px] text-dark/80 leading-relaxed">
                {cut.description}
              </p>
            </div>

            <figure>
              {cut.imageUrl ? (
                <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-stone-100">
                  <Image
                    src={cut.imageUrl}
                    alt={cut.imageAlt ?? cut.name}
                    fill
                    sizes="(min-width: 768px) 60vw, 100vw"
                    className="object-cover"
                  />
                </div>
              ) : (
                <div className="flex aspect-[4/3] w-full items-center justify-center rounded-2xl bg-stone-100">
                  <span className="text-[12px] uppercase tracking-wider text-terra-700">
                    Photo à venir
                  </span>
                </div>
              )}
              {cut.imageCredit && (
                <figcaption className="mt-2 text-xs text-stone-500">
                  {cut.imageCredit}
                </figcaption>
              )}
            </figure>

            <div>
              <h2 className="font-serif text-[24px] text-green-900">
                Modes de cuisson
              </h2>
              <ul className="mt-3 flex flex-wrap gap-2">
                {cut.cookingMethods.map((method) => (
                  <li
                    key={method}
                    className="inline-flex items-center rounded-full bg-terra-50 border border-terra-200 px-3 py-1 text-[13px] text-terra-700"
                  >
                    {method}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h2 className="font-serif text-[24px] text-green-900">
                Plats emblématiques
              </h2>
              <ul className="mt-3 list-disc pl-5 space-y-1 text-[15px] text-dark/80">
                {cut.signatureDishes.map((dish) => (
                  <li key={dish}>{dish}</li>
                ))}
              </ul>
            </div>
          </section>

          <aside className="md:sticky md:top-24">
            <CowDiagramMini
              svgMarkup={svgMarkup}
              slug={slug as BeefCutSlug}
            />
          </aside>
        </div>
      </article>

      <Script id={`ld-cut-${slug}`} type="application/ld+json">
        {JSON.stringify(jsonLd)}
      </Script>
    </div>
  );
}
