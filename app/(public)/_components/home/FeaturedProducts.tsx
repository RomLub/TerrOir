import Link from "next/link";
import { ProductCard } from "@/components/ui/product-card";
import { getFeaturedProducts } from "@/lib/products/fetch-featured";

// Section "Les produits du moment" (homepage.html .products).
//
// Audit Vercel H-6 (2026-05-05) : Server Component branché Supabase via
// getFeaturedProducts() — unstable_cache 10 min + tag 'featured-products'.
// Avant : import FEATURED_PRODUCTS depuis lib/mocks/featured-products
// (mocks en prod, audit C). Le composant est désormais async.
//
// Si fetch fail-open → tableau vide → la section affiche le header sans
// cards (cohérent avec getPublicStats).
//
// CTA "Voir les 320 produits" pointe vers /producteurs (Phase 1). Le
// compte "320" reste statique acceptable MVP.

export type FeaturedProductsProps = { className?: string };

export async function FeaturedProducts({
  className = "",
}: FeaturedProductsProps) {
  const products = await getFeaturedProducts();

  return (
    <section
      id="produits"
      className={`bg-terroir-bg ${className}`}
    >
      <div className="mx-auto max-w-6xl px-4 py-16 md:py-20">
        <div className="mb-9 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-terra-700">
              Les produits du moment
            </span>
            <h2 className="mt-3 font-serif text-[32px] font-medium leading-[1.1] tracking-[-0.005em] text-green-900 md:text-[44px]">
              Ce que les fermes ont sorti
              <br />
              cette semaine.
            </h2>
          </div>
          <Link
            href="/producteurs"
            className="text-sm font-medium text-terra-700 transition-colors hover:text-terra-900"
          >
            Voir les 320 produits&nbsp;→
          </Link>
        </div>
        {products.length > 0 ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {products.map((product) => (
              <Link
                key={product.id}
                href={`/producteurs/${product.producerSlug}/produits/${product.id}`}
                className="block rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-terra-700"
              >
                <ProductCard product={product} />
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
