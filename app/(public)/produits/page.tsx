import type { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { ProductCard } from '@/components/ui';
import {
  type PublicProductRow,
  type ResolvedFilters,
} from '@/lib/products/fetch-products-public';
import { getPublicProducts } from '@/lib/products/fetch-products-public-cached';
import { parseProductsSearchParams } from '@/lib/products/parse-search-params';
import { STOCK_UNLIMITED_SENTINEL } from '@/lib/products/constants';

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
  title: 'Tous les produits | TerrOir',
  description:
    'Découvrez tous les produits disponibles chez nos éleveurs sarthois. Filtrez par catégorie, animal ou morceau.',
};

export const revalidate = 60;

type SearchParams = Record<string, string | string[] | undefined>;
type ActivePill = { label: string; resetHref: string };

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
  const suspenseKey = JSON.stringify(searchParams);

  return (
    <div className="max-w-7xl mx-auto px-8 py-10">
      <h1 className="mb-2 font-serif text-[40px] text-green-900 leading-tight">
        Tous les produits
      </h1>
      <Suspense key={suspenseKey} fallback={<ProduitsResultsSkeleton />}>
        <ProduitsResults searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function ProduitsResults({ searchParams }: { searchParams: SearchParams }) {
  const filters = parseProductsSearchParams(searchParams);
  const { products, resolved } = await getPublicProducts(filters);
  const pills = buildPills(resolved, searchParams);

  return (
    <>
      <header className="mb-8">
        <p className="text-[14px] text-dark/60">
          {products.length} produit{products.length !== 1 ? 's' : ''} disponible
          {products.length !== 1 ? 's' : ''}.
        </p>

        {pills.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
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
      </header>

      {products.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dark/[0.06] p-12 text-center">
          <p className="font-serif text-[20px] text-green-900">
            Aucun produit ne correspond à ce filtre.
          </p>
          <p className="text-[14px] text-dark/60 mt-2">
            <Link href="/produits" className="text-green-700 underline hover:text-green-900">
              Voir tous les produits
            </Link>
          </p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {products.map((p) => {
            // ProductCard considère stockLeft<=0 comme épuisé et <=5 comme
            // low stock. Pour un produit illimité, on passe la sentinelle
            // STOCK_UNLIMITED_SENTINEL pour échapper aux deux seuils.
            // Pattern hérité de catalogue/nouveau et catalogue/[id]/modifier
            // (form preview). Backlog : refacto ProductCard pour accepter
            // `stockLeft: number | 'unlimited'`.
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
