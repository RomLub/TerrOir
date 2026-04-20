import { Badge } from "./badge";

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
  onClick?: () => void;
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

export function ProductCard({
  product,
  onClick,
  className = "",
}: ProductCardProps) {
  const outOfStock = product.stockLeft <= 0;
  const lowStock = !outOfStock && product.stockLeft <= 5;

  return (
    <article
      onClick={onClick}
      className={`group flex flex-col overflow-hidden rounded-2xl border border-terroir-border bg-white shadow-sm transition hover:shadow-md ${
        onClick ? "cursor-pointer" : ""
      } ${className}`}
    >
      <div
        className="relative aspect-[4/3] w-full bg-terroir-green-100"
        aria-hidden
        style={
          product.image
            ? {
                backgroundImage: `url(${product.image})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : undefined
        }
      >
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
        <p className="mt-auto pt-2 font-medium text-terroir-green-700">
          {formatPrice(product.price)}
          {product.unit ? (
            <span className="text-sm text-terroir-muted"> / {product.unit}</span>
          ) : null}
        </p>
      </div>
    </article>
  );
}
