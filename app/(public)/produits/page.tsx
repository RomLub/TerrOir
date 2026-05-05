import type { Metadata } from 'next';
import Link from 'next/link';
import { ProductCard } from '@/components/ui';
import {
  type PublicProductRow,
  type ResolvedFilters,
} from '@/lib/products/fetch-products-public';
import { getPublicProducts } from '@/lib/products/fetch-products-public-cached';
import { parseProductsSearchParams } from '@/lib/products/parse-search-params';

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

export default async function ProduitsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const filters = parseProductsSearchParams(searchParams);
  const { products, resolved } = await getPublicProducts(filters);
  const pills = buildPills(resolved, searchParams);

  return (
    <div className="max-w-7xl mx-auto px-8 py-10">
      <header className="mb-8">
        <h1 className="font-serif text-[40px] text-green-900 leading-tight">
          Tous les produits
        </h1>
        <p className="text-[14px] text-dark/60 mt-2">
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
            // 999 pour échapper aux deux seuils. Pattern hérité de
            // catalogue/nouveau et catalogue/[id]/modifier (form preview).
            // Dette : refacto ProductCard pour accepter
            // `stockLeft: number | 'unlimited'` — ticket T-XXX à ouvrir.
            const stockLeft = p.stock_illimite
              ? 999
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
    </div>
  );
}
