import Image from "next/image";
import { Badge } from "./badge";
import { ProductFallback } from "./product-fallback";

export type ProductCardData = {
  id: string;
  name: string;
  price: number;
  unit?: string;
  stockLeft: number;
  producer?: string;
  category?: string;
  image?: string | null;
};

export type ProductCardProps = {
  product: ProductCardData;
  className?: string;
};

function formatPrice(price: number) {
  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
    }).format(price);
  } catch {
    return `${price.toFixed(2)} €`;
  }
}

export function ProductCard({ product, className = "" }: ProductCardProps) {
  const outOfStock = product.stockLeft <= 0;
  const lowStock = !outOfStock && product.stockLeft <= 5;

  // Hover state : lift + shadow renforcée pour confirmer l'affordance quand
  // la carte est enveloppée d'un <Link>. Les usages display-only (previews
  // form catalogue) montrent la même animation au survol — non bloquant,
  // c'est un aperçu de l'apparence client.
  return (
    <article
      className={`group flex h-full flex-col overflow-hidden rounded-2xl border border-terroir-border bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md ${className}`}
    >
      <div className="relative aspect-4/3 w-full overflow-hidden">
        {product.image ? (
          <Image
            src={product.image}
            alt={product.name}
            fill
            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
            className="object-cover"
          />
        ) : (
          <ProductFallback
            category={product.category}
            className="h-full w-full"
          />
        )}
        {product.category ? (
          <div className="absolute left-2 top-2">
            <Badge variant="neutral">{product.category}</Badge>
          </div>
        ) : null}
        {outOfStock ? (
          <div className="absolute right-2 top-2">
            <Badge variant="danger">Épuisé</Badge>
          </div>
        ) : lowStock ? (
          <div className="absolute right-2 top-2">
            <Badge variant="terra">Plus que {product.stockLeft}</Badge>
          </div>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-4">
        <h3 className="font-serif text-lg text-terroir-ink line-clamp-1">
          {product.name}
        </h3>
        {product.producer ? (
          <p className="text-xs text-terroir-muted line-clamp-1">
            {product.producer}
          </p>
        ) : null}
        <p className="mt-auto pt-2 font-medium text-terra-700 tabular-nums">
          {formatPrice(product.price)}
          {product.unit ? (
            <span className="text-sm font-normal text-terroir-muted"> / {product.unit}</span>
          ) : null}
        </p>
      </div>
    </article>
  );
}
