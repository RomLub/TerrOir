import type { Metadata } from 'next';
import { unstable_cache } from 'next/cache';
import type { ReactNode } from 'react';
import { Suspense } from 'react';
import Link from 'next/link';
import { ProductCard } from '@/components/ui';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  type PublicProductRow,
  type ResolvedFilters,
} from '@/lib/products/fetch-products-public';
import { getPublicProducts } from '@/lib/products/fetch-products-public-cached';
import { parseProductsSearchParams } from '@/lib/products/parse-search-params';
import { STOCK_UNLIMITED_SENTINEL } from '@/lib/products/constants';
import {
  fetchAnimals,
  fetchCuts,
  fetchProductCategories,
} from '@/lib/products/fetch-references';
import type { Animal, Cut, ProductCategory } from '@/lib/products/types';

// Page catalogue produits public (T-220 PR-C).
//
// Server Component, fetch SSR via getPublicProducts (unstable_cache + tag
// 'public-products', revalidate 60s — audit Vercel C-5 2026-05-05). Avant :
// force-dynamic + revalidate 0 → page reconstruite à chaque requête. Après :
// cache 60s côté Vercel + invalidation immédiate via revalidatePublicProducts
// déclenchée par les mutations catalogue (create/update/toggle).
//
// Filtres querystring (combinables) :
//   ?category=<slug>  → filtre par product_categories.slug
//   ?animal=<slug>    → filtre par animals.slug
//   ?cut=<slug>       → filtre par cuts.slug
//
// Slug invalide (regex ou non-existant en DB) → 0 résultats gracieux
// (pas de 404, cf. décision Q3).
//
// SEO : metadata statique. Les filtres querystring n'enrichissent pas
// le title — décision pragmatique pour MVP (peu d'intérêt SEO sur des
// pages filtrées combinatoires). À enrichir plus tard via
// generateMetadata si besoin.

export const metadata: Metadata = {
  title: 'Acheter des produits locaux | TerrOir',
  description:
    'Achetez les produits disponibles chez les producteurs sarthois. Filtrez par catégorie, animal ou morceau.',
};

export const revalidate = 60;

type SearchParams = Record<string, string | string[] | undefined>;
type ActivePill = { label: string; resetHref: string };
type ProductFilterRefs = {
  categories: ProductCategory[];
  animals: Animal[];
  cuts: Cut[];
};

const CUT_FILTER_LIMIT = 12;

const EMPTY_FILTER_REFS: ProductFilterRefs = {
  categories: [],
  animals: [],
  cuts: [],
};

const getProductFilterRefs = unstable_cache(
  async (): Promise<ProductFilterRefs> => {
    const admin = createSupabaseAdminClient();
    try {
      const [categories, animals, cuts] = await Promise.all([
        fetchProductCategories(admin),
        fetchAnimals(admin),
        fetchCuts(admin),
      ]);
      return { categories, animals, cuts };
    } catch (error) {
      console.error('[PRODUCT_FILTER_REFS_ERR]', error);
      return EMPTY_FILTER_REFS;
    }
  },
  ['public-product-filter-refs'],
  {
    revalidate: 3600,
    tags: ['public-products'],
  },
);

// Reconstruit l'URL en retirant la clé courante du filtre. Les autres
// filtres (et tout searchParam non-string ignoré) sont préservés.
function hrefWithout(searchParams: SearchParams, omit: string): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (k === omit || typeof v !== 'string') continue;
    params.set(k, v);
  }
  const qs = params.toString();
  return qs ? `/produits?${qs}` : '/produits';
}

function hrefWith(searchParams: SearchParams, key: string, value: string): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (typeof v !== 'string') continue;
    params.set(k, v);
  }
  if (params.get(key) === value) params.delete(key);
  else params.set(key, value);
  const qs = params.toString();
  return qs ? `/produits?${qs}` : '/produits';
}

// Pills construits à partir de `resolved` (et non du slug brut) pour
// afficher le label humain ("Entrecôte" plutôt que "entrecote"). Si une
// résolution est null (slug invalide en DB), pas de pill — cohérent avec
// l'état "0 résultats" affiché en dessous (décision Q3).
function buildPills(
  resolved: ResolvedFilters,
  searchParams: SearchParams,
): ActivePill[] {
  const pills: ActivePill[] = [];
  if (resolved.category) {
    pills.push({ label: resolved.category.name, resetHref: hrefWithout(searchParams, 'category') });
  }
  if (resolved.animal) {
    pills.push({ label: resolved.animal.name, resetHref: hrefWithout(searchParams, 'animal') });
  }
  if (resolved.cut) {
    pills.push({ label: resolved.cut.name, resetHref: hrefWithout(searchParams, 'cut') });
  }
  return pills;
}

// Priorité au plus précis (cf. décision Q1) : cut > animal > category.
// Le ProductCard affiche un seul badge, on lui passe le label le plus
// informatif disponible pour le visiteur.
function badgeFor(p: PublicProductRow): string | undefined {
  return p.cuts?.name ?? p.animals?.name ?? p.product_categories?.name ?? undefined;
}

// Perf (latence-navigation 2026-05-24) : shell streamé. Le composant page rend
// le cadre (titre h1) instantanément et déporte le fetch dans <ProduitsResults>
// (async), enveloppé d'un <Suspense>. Le compteur + les pills + la grille
// dépendent tous de la même requête : ils sont donc streamés ensemble derrière
// un skeleton de grille. Avant, le fetch bloquait tout le rendu de la page et
// remontait au loading.tsx pleine page. La clé du Suspense est dérivée des
// searchParams pour re-déclencher le fallback quand on change de filtre.
export default async function ProduitsPage(
  props: {
    searchParams: Promise<SearchParams>;
  }
) {
  const searchParams = await props.searchParams;
  const filters = parseProductsSearchParams(searchParams);
  const suspenseKey = JSON.stringify(searchParams);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 md:px-8 md:py-10">
      <header className="mb-8 max-w-3xl">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-terra-700">
          Acheter maintenant
        </span>
        <h1 className="mt-3 font-serif text-[40px] leading-tight text-green-900 md:text-[56px]">
          Acheter des produits locaux
        </h1>
        <p className="mt-3 text-[16px] leading-relaxed text-dark/70 md:text-[18px]">
          Viande, charcuterie, paniers et produits de saison : pars du produit,
          puis choisis le retrait qui te convient sur la fiche.
        </p>
      </header>

      <form
        action="/produits"
        className="mb-6 flex flex-col gap-3 rounded-2xl border border-dark/[0.06] bg-white p-4 shadow-soft md:flex-row md:items-center"
      >
        <label className="sr-only" htmlFor="product-search">
          Rechercher un produit
        </label>
        <input
          id="product-search"
          name="q"
          type="search"
          defaultValue={filters.q ?? ''}
          placeholder="Rechercher un produit : entrecôte, poulet, saucisson..."
          className="min-h-12 flex-1 rounded-xl border border-dark/10 bg-bg px-4 text-[15px] text-dark outline-none transition focus:border-green-700 focus:ring-2 focus:ring-green-700/15"
        />
        {filters.category ? <input type="hidden" name="category" value={filters.category} /> : null}
        {filters.animal ? <input type="hidden" name="animal" value={filters.animal} /> : null}
        {filters.cut ? <input type="hidden" name="cut" value={filters.cut} /> : null}
        <button
          type="submit"
          className="inline-flex min-h-12 items-center justify-center rounded-xl bg-terra-700 px-5 text-[15px] font-semibold text-white transition-colors hover:bg-terra-800 focus:outline-none focus:ring-2 focus:ring-terra-700 focus:ring-offset-2"
        >
          Trouver
        </button>
      </form>

      <Suspense key={suspenseKey} fallback={<ProduitsResultsSkeleton />}>
        <ProduitsResults searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function ProduitsResults({ searchParams }: { searchParams: SearchParams }) {
  const filters = parseProductsSearchParams(searchParams);
  const [{ products, resolved }, refs] = await Promise.all([
    getPublicProducts(filters),
    getProductFilterRefs(),
  ]);
  const pills = buildPills(resolved, searchParams);
  const hasActiveIntent = Boolean(filters.q || pills.length > 0);

  return (
    <>
      <section className="mb-8 space-y-4 rounded-2xl border border-dark/[0.06] bg-white p-4 shadow-soft">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <p className="text-[14px] text-dark/65">
            {filters.q ? `Recherche "${filters.q}" · ` : ''}
          {products.length} produit{products.length !== 1 ? 's' : ''} disponible
          {products.length !== 1 ? 's' : ''}.
        </p>
          {hasActiveIntent ? (
            <Link
              href="/produits"
              className="text-[13px] font-medium text-green-700 underline-offset-4 hover:text-green-900 hover:underline"
            >
              Voir tous les produits
            </Link>
          ) : null}
        </div>

        {pills.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {pills.map((pill) => (
              <Link
                key={pill.label}
                href={pill.resetHref}
                className="inline-flex items-center gap-2 rounded-full border border-dark/15 bg-white px-3 py-1 text-[13px] text-dark/80 hover:border-dark/40 hover:bg-dark/5"
              >
                <span>{pill.label}</span>
                <span aria-hidden className="text-dark/50">✕</span>
                <span className="sr-only">Retirer ce filtre</span>
              </Link>
            ))}
          </div>
        )}

        <ProductFilterLinks
          refs={refs}
          searchParams={searchParams}
          resolved={resolved}
        />
      </section>

      {products.length === 0 ? (
        <div className="rounded-2xl border border-dark/[0.06] bg-white p-10 text-center shadow-soft md:p-12">
          <p className="font-serif text-[24px] text-green-900">
            {hasActiveIntent
              ? 'Aucun produit trouvé'
              : 'Aucun produit disponible pour le moment'}
          </p>
          <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-dark/65">
            {hasActiveIntent
              ? 'Essaie un autre mot, retire un filtre ou repars de tous les produits disponibles.'
              : 'Les producteurs n\'ont pas encore publié de produits achetables.'}
          </p>
          <div className="mt-5 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              href="/produits"
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-terra-700 px-4 text-[14px] font-semibold text-white transition-colors hover:bg-terra-800"
            >
              Voir tous les produits
            </Link>
            <Link
              href="/producteurs"
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-dark/10 px-4 text-[14px] font-semibold text-green-900 transition-colors hover:border-green-700 hover:bg-green-100/50"
            >
              Découvrir les producteurs
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {products.map((p) => {
            // ProductCard considère stockLeft<=0 comme épuisé et <=5 comme
            // low stock. Pour un produit illimité, on passe la sentinelle
            // STOCK_UNLIMITED_SENTINEL pour échapper aux deux seuils.
            // Pattern hérité de catalogue/nouveau et catalogue/[id]/modifier
            // (form preview).
            const stockLeft = p.stock_illimite
              ? STOCK_UNLIMITED_SENTINEL
              : p.stock_disponible ?? 0;
            return (
              <Link
                key={p.id}
                href={`/producteurs/${p.producers.slug}/produits/${p.id}`}
                className="block rounded-2xl focus:outline-none focus:ring-2 focus:ring-green-700"
              >
                <ProductCard
                  product={{
                    id: p.id,
                    name: p.nom,
                    price: Number(p.prix),
                    unit: p.unite ?? undefined,
                    stockLeft,
                    producer: p.producers.nom_exploitation,
                    category: badgeFor(p),
                    image:
                      Array.isArray(p.photos) && p.photos.length > 0
                        ? p.photos[0]
                        : null,
                  }}
                />
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

function ProductFilterLinks({
  refs,
  searchParams,
  resolved,
}: {
  refs: ProductFilterRefs;
  searchParams: SearchParams;
  resolved: ResolvedFilters;
}) {
  const cuts = refs.cuts.slice(0, CUT_FILTER_LIMIT);

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <FilterGroup title="Catégories">
        {refs.categories.map((category) => (
          <FilterChip
            key={category.slug}
            href={hrefWith(searchParams, 'category', category.slug)}
            active={resolved.category?.slug === category.slug}
          >
            {category.name}
          </FilterChip>
        ))}
      </FilterGroup>
      <FilterGroup title="Animaux">
        {refs.animals.map((animal) => (
          <FilterChip
            key={animal.slug}
            href={hrefWith(searchParams, 'animal', animal.slug)}
            active={resolved.animal?.slug === animal.slug}
          >
            {animal.name}
          </FilterChip>
        ))}
      </FilterGroup>
      <FilterGroup title="Morceaux">
        {cuts.map((cut) => (
          <FilterChip
            key={cut.slug}
            href={hrefWith(searchParams, 'cut', cut.slug)}
            active={resolved.cut?.slug === cut.slug}
          >
            {cut.name}
          </FilterChip>
        ))}
      </FilterGroup>
    </div>
  );
}

function FilterGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-dark/55">
        {title}
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={`inline-flex min-h-8 items-center rounded-full border px-3 text-[13px] font-medium transition-colors ${
        active
          ? 'border-green-700 bg-green-700 text-white'
          : 'border-dark/10 bg-white text-dark/70 hover:border-green-500 hover:text-green-900'
      }`}
    >
      {children}
    </Link>
  );
}

// Skeleton du bloc résultats (compteur + grille), affiché pendant le fetch.
// Réutilise le markup de carte de produits/loading.tsx pour rester cohérent.
function ProduitsResultsSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="mb-8 h-4 w-48 animate-pulse rounded-md bg-dark/10" />
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <div
            key={i}
            className="overflow-hidden rounded-2xl border border-terroir-border bg-white shadow-sm"
          >
            <div className="relative aspect-4/3 w-full animate-pulse bg-terroir-green-100" />
            <div className="space-y-3 p-4">
              <div className="h-5 w-3/4 animate-pulse rounded bg-dark/10" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-dark/10" />
              <div className="h-5 w-1/3 animate-pulse rounded bg-dark/10" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
