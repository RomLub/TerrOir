import type { Metadata } from 'next';
import Link from 'next/link';
import Script from 'next/script';
import { notFound } from 'next/navigation';
import { CookingIcon } from '@/components/beef/CookingIcon';
import { CowSchemaMini } from '@/components/beef/CowSchemaMini';
import { loadCowSvgV2 } from '@/lib/beef/load-cow-svg';
import {
  ALL_CUT_SLUGS,
  BEEF_CUTS,
  CATEGORY_TO_FAMILY,
  FAMILY_META,
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
    return { title: 'Morceau introuvable | TerrOir' };
  }
  return {
    title: `${cut.name} — Morceau du boeuf | TerrOir`,
    description: cut.shortLede ?? cut.shortDescription,
  };
}

function getNeighbors(slug: BeefCutSlug): {
  prev: BeefCutSlug | null;
  next: BeefCutSlug | null;
} {
  const idx = ALL_CUT_SLUGS.indexOf(slug);
  return {
    prev: idx > 0 ? ALL_CUT_SLUGS[idx - 1] : null,
    next: idx < ALL_CUT_SLUGS.length - 1 ? ALL_CUT_SLUGS[idx + 1] : null,
  };
}

export default async function CutDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug: rawSlug } = await params;
  const cut = getCutBySlug(rawSlug);
  if (!cut) notFound();

  const slug = cut.slug;
  const family = cut.family ?? CATEGORY_TO_FAMILY[cut.category];
  const familyMeta = FAMILY_META[family];
  const svgMarkup = await loadCowSvgV2();
  const { prev, next } = getNeighbors(slug);

  const longParagraphs = (cut.longDescription ?? cut.description).split('\n\n');
  const cookingDetails = cut.cookingDetails ?? [];
  const portionGrams = cut.portionGrams ?? 200;
  const season = cut.season ?? "Toute l'annee";

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: `${cut.name} — Morceau du boeuf`,
    description: cut.shortLede ?? cut.shortDescription,
    articleSection: familyMeta.label,
    inLanguage: 'fr-FR',
    isPartOf: { '@type': 'WebSite', name: 'TerrOir' },
    about: { '@type': 'Thing', name: cut.name },
  };

  return (
    <div className="bg-bg">
      <main className="max-w-[1280px] mx-auto px-6 md:px-8 pt-8 pb-20">
        {/* Breadcrumb */}
        <nav
          className="flex items-center gap-2 text-[13px] text-terroir-ink/55 mb-8 flex-wrap"
          aria-label="Breadcrumb"
        >
          <Link
            href="/notre-demarche"
            className="hover:text-terra-700 transition-colors"
          >
            Notre demarche
          </Link>
          <span aria-hidden="true">›</span>
          <Link
            href="/decoupe-boeuf"
            className="hover:text-terra-700 transition-colors"
          >
            Decoupe du boeuf
          </Link>
          <span aria-hidden="true">›</span>
          <span className="text-terroir-ink">{cut.name}</span>
        </nav>

        {/* Hero : photo + identite */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 mb-14">
          <div className="lg:col-span-7">
            {cut.imageUrl ? (
              <div className="relative aspect-[4/3] max-h-[400px] w-full overflow-hidden rounded-3xl bg-stone-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={cut.imageUrl}
                  alt={cut.imageAlt ?? cut.name}
                  className="absolute inset-0 w-full h-full object-cover"
                />
              </div>
            ) : (
              <div className="flex aspect-[4/3] max-h-[400px] w-full items-center justify-center rounded-3xl bg-stone-100">
                <span className="text-[12px] uppercase tracking-wider text-terra-700 font-semibold">
                  Photo a venir
                </span>
              </div>
            )}
          </div>

          <div className="lg:col-span-5 flex flex-col">
            <Link
              href="/decoupe-boeuf"
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
            </Link>

            <div className="inline-flex items-center gap-2 mb-3">
              <span
                className="px-3 py-1 rounded-full text-[11px] font-semibold tracking-[0.15em] uppercase text-white"
                style={{ background: familyMeta.fillColor }}
              >
                {familyMeta.label}
              </span>
            </div>

            <h1 className="font-serif text-[44px] md:text-[64px] leading-[1.0] font-medium tracking-tight text-terroir-ink">
              {cut.name}
            </h1>

            <p className="mt-5 text-[16px] md:text-[18px] leading-[1.5] text-terroir-ink/75">
              {cut.shortLede ?? cut.shortDescription}
            </p>

            <div className="grid grid-cols-2 gap-3 mt-6">
              <div className="bg-white rounded-2xl border border-terroir-border px-4 py-3.5">
                <div className="text-[10.5px] uppercase tracking-wider font-semibold text-terroir-ink/50">
                  Compter
                </div>
                <div className="font-semibold text-[18px] mt-1 tabular-nums">
                  {portionGrams}
                  <span className="text-[12px] text-terroir-ink/55 font-normal">
                    {' '}
                    g/pers
                  </span>
                </div>
              </div>
              <div className="bg-white rounded-2xl border border-terroir-border px-4 py-3.5">
                <div className="text-[10.5px] uppercase tracking-wider font-semibold text-terroir-ink/50">
                  Saison
                </div>
                <div className="font-semibold text-[14px] mt-1.5">
                  {season}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Description longue + Localisation */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 mb-16">
          <div className="lg:col-span-7">
            <div className="text-[11px] uppercase tracking-[0.18em] font-semibold text-terra-700 mb-3">
              Le morceau
            </div>
            <h2 className="font-serif text-[28px] md:text-[36px] leading-[1.1] font-medium mb-4">
              {cut.name}
            </h2>
            <div className="text-[16px] leading-[1.65] text-terroir-ink/80 space-y-4">
              {longParagraphs.map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>

            {cut.butcherCounsel && (
              <div className="postit mt-7 max-w-[460px]">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-postit-fill flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="#F59E0B"
                      stroke="none"
                      aria-hidden="true"
                    >
                      <path d="M12 2C8 2 5 5 5 9c0 2.5 1.5 4.5 3 6v3a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-3c1.5-1.5 3-3.5 3-6 0-4-3-7-7-7z" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-[10.5px] uppercase tracking-wider font-semibold text-amber-700 mb-1">
                      Conseil de l&apos;eleveur
                    </div>
                    <p className="font-serif italic text-[15px] leading-[1.45] text-terroir-ink/85">
                      &laquo;&nbsp;{cut.butcherCounsel.quote}&nbsp;&raquo;
                    </p>
                    <div className="text-[12px] text-terroir-ink/55 mt-2">
                      — {cut.butcherCounsel.author}, {cut.butcherCounsel.farm}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <aside className="lg:col-span-5">
            <div className="bg-white rounded-3xl border border-terroir-border p-6 lg:sticky lg:top-24 shadow-soft">
              <div className="text-[11px] uppercase tracking-[0.18em] font-semibold text-terra-700 mb-3">
                Localisation
              </div>
              <h3 className="font-serif text-[20px] leading-[1.15] font-medium mb-4">
                Sur la bete
              </h3>
              <CowSchemaMini svgMarkup={svgMarkup} slug={slug} />
              <div className="mt-4 pt-4 border-t border-terroir-border">
                <div className="text-[12px] text-terroir-ink/60 leading-[1.5]">
                  <strong className="text-terra-700 font-semibold">
                    {familyMeta.label}
                  </strong>{' '}
                  — la zone surlignee correspond a la position anatomique du
                  morceau sur l&apos;animal.
                </div>
              </div>
            </div>
          </aside>
        </section>

        {/* Cuissons */}
        {cookingDetails.length > 0 && (
          <section className="mb-16">
            <div className="text-[11px] uppercase tracking-[0.18em] font-semibold text-terra-700 mb-3">
              Comment cuire
            </div>
            <h2 className="font-serif text-[28px] md:text-[36px] leading-[1.1] font-medium mb-3">
              Les bonnes <em className="text-terra-700 italic">cuissons</em>
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-7">
              {cookingDetails.map((method) => (
                <article
                  key={method.id}
                  className="bg-white rounded-2xl border border-terroir-border p-6"
                >
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-11 h-11 rounded-full bg-terra-100 flex items-center justify-center text-terra-700">
                      <CookingIcon label={method.label} />
                    </div>
                    <h3 className="font-serif text-[22px] font-medium leading-tight">
                      {method.label}
                    </h3>
                  </div>
                  <p className="text-[14px] text-terroir-ink/75 leading-[1.55] mb-4">
                    {method.description}
                  </p>
                  <div className="flex items-center justify-between text-[12.5px] text-terroir-ink/60 pt-3 border-t border-terroir-border">
                    <span>
                      <strong className="text-terra-700 font-semibold">
                        {method.recommended ? '★★★' : '★★'}
                      </strong>{' '}
                      {method.recommended ? 'recommandee' : 'alternative'}
                    </span>
                    <span className="tabular-nums">
                      {method.durationMin === 0
                        ? 'cru'
                        : `~${method.durationMin} min`}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {/* Producteurs (mode degrade) */}
        <section className="mb-16">
          <div className="text-[11px] uppercase tracking-[0.18em] font-semibold text-terra-700 mb-3">
            En Sarthe
          </div>
          <h2 className="font-serif text-[28px] md:text-[36px] leading-[1.1] font-medium mb-7">
            Les eleveurs proposent ce morceau
          </h2>

          <div className="bg-white rounded-3xl border border-terroir-border p-8 md:p-10 text-center shadow-soft max-w-[640px] mx-auto">
            <p className="text-[15px] leading-[1.55] text-terroir-ink/75">
              Le lien entre morceaux et producteurs est en cours de mise en
              place. Tres prochainement, vous pourrez voir ici les eleveurs
              Sarthois qui proposent ce morceau.
            </p>
            <Link
              href="/producteurs"
              className="mt-5 inline-flex items-center justify-center gap-2 px-6 h-12 rounded-full bg-green-700 hover:bg-green-900 text-white text-[14px] font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-green-700 focus:ring-offset-2 focus:ring-offset-terroir-bg"
            >
              Voir tous nos producteurs
              <svg
                width="16"
                height="16"
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
            </Link>
          </div>
        </section>

        {/* Recettes (mode degrade) */}
        <section className="mb-16">
          <div className="text-[11px] uppercase tracking-[0.18em] font-semibold text-terra-700 mb-3">
            A cuisiner
          </div>
          <h2 className="font-serif text-[28px] md:text-[36px] leading-[1.1] font-medium mb-7">
            Recettes <em className="text-terra-700 italic">associees</em>
          </h2>

          <div className="bg-white rounded-3xl border border-terroir-border p-8 md:p-10 text-center shadow-soft max-w-[640px] mx-auto">
            <p className="text-[15px] leading-[1.55] text-terroir-ink/75">
              Les recettes associees a ce morceau arrivent prochainement. En
              attendant, jetez un oeil aux modes de cuisson recommandes
              ci-dessus pour vous lancer.
            </p>
          </div>
        </section>

        {/* Pagination prev/next */}
        {(prev || next) && (
          <section className="border-t border-terroir-border pt-10">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {prev ? (
                <Link
                  href={`/decoupe-boeuf/${prev}`}
                  className="bg-white rounded-2xl border border-terroir-border p-6 hover:border-terra-700 transition-colors group"
                >
                  <div className="text-[11.5px] uppercase tracking-wider font-semibold text-terroir-ink/50 mb-2">
                    ← Precedent
                  </div>
                  <h3 className="font-serif text-[24px] md:text-[26px] leading-[1.1] font-medium group-hover:text-terra-700 transition-colors">
                    {BEEF_CUTS[prev].name}
                  </h3>
                  <div className="text-[13px] text-terroir-ink/55 mt-1">
                    {BEEF_CUTS[prev].shortLede ??
                      BEEF_CUTS[prev].shortDescription}
                  </div>
                </Link>
              ) : (
                <span aria-hidden="true" />
              )}

              {next ? (
                <Link
                  href={`/decoupe-boeuf/${next}`}
                  className="bg-white rounded-2xl border border-terroir-border p-6 hover:border-terra-700 transition-colors group md:text-right"
                >
                  <div className="text-[11.5px] uppercase tracking-wider font-semibold text-terroir-ink/50 mb-2">
                    Suivant →
                  </div>
                  <h3 className="font-serif text-[24px] md:text-[26px] leading-[1.1] font-medium group-hover:text-terra-700 transition-colors">
                    {BEEF_CUTS[next].name}
                  </h3>
                  <div className="text-[13px] text-terroir-ink/55 mt-1">
                    {BEEF_CUTS[next].shortLede ??
                      BEEF_CUTS[next].shortDescription}
                  </div>
                </Link>
              ) : (
                <span aria-hidden="true" />
              )}
            </div>
          </section>
        )}
      </main>

      <Script id={`ld-cut-${slug}`} type="application/ld+json">
        {JSON.stringify(jsonLd)}
      </Script>
    </div>
  );
}
