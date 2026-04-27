import Link from "next/link";
import { ProductCard } from "@/components/ui/product-card";
import { FEATURED_PRODUCTS } from "@/lib/mocks/featured-products";

// Section "Les produits du moment" (homepage.html .products).
//
// Phase 1 : 4 produits issus de lib/mocks/featured-products. Phase 2 :
// remplacer par getFeaturedProducts({ limit: 4 }) Supabase.
//
// CTA "Voir les 320 produits" pointe vers /producteurs en Phase 1 (la
// route /produits n'existe pas encore — sera Phase 2). Le compte "320"
// est cohérent avec la stat du screen, statique acceptable Phase 1.

export type FeaturedProductsProps = { className?: string };

export function FeaturedProducts({
  className = "",
}: FeaturedProductsProps) {
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
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURED_PRODUCTS.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </div>
    </section>
  );
}
