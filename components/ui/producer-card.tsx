import Image from "next/image";
import { Badge } from "./badge";
import { StarRating } from "./star-rating";

// Visuel de secours tant qu'aucune photo n'a été uploadée — chemin de
// campagne sarthois (PR3 audit photos 2026-05-17 : remplace l'URL
// Unsplash hardcodée par un asset local en format card-1x1).
const DEFAULT_PRODUCER_PHOTO =
  "/images/editorial/photo16_chemin-arbres_card-1x1.jpg";

export type ProducerCardData = {
  name: string;
  commune: string;
  distanceKm?: number;
  species?: string[];
  labels?: string[];
  scores?: { stock: number; response: number; reliability: number };
  rating: number;
  reviewCount: number;
  productCount: number;
  photo?: string | null;
};

export type ProducerCardProps = {
  producer: ProducerCardData;
  className?: string;
};

export function ProducerCard({ producer, className = "" }: ProducerCardProps) {
  const {
    name,
    commune,
    distanceKm,
    species,
    labels,
    rating,
    reviewCount,
    productCount,
  } = producer;

  const photo = producer.photo ?? DEFAULT_PRODUCER_PHOTO;

  return (
    <article
      className={`flex gap-4 rounded-2xl border border-terroir-border bg-white p-4 shadow-sm transition hover:shadow-md ${className}`}
    >
      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-terroir-green-100">
        <Image
          src={photo}
          alt=""
          fill
          sizes="80px"
          className="object-cover"
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-serif text-lg text-terroir-ink line-clamp-1">
              {name}
            </h3>
            <p className="text-xs text-terroir-muted line-clamp-1">
              {commune}
              {typeof distanceKm === "number"
                ? ` · ${distanceKm.toFixed(1)} km`
                : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1 text-xs">
            <StarRating value={rating} readOnly size="sm" />
            <span className="font-semibold text-terroir-green-700 tabular-nums">
              {rating.toFixed(1)}
            </span>
            <span className="text-terroir-muted">({reviewCount})</span>
          </div>
        </div>

        {(species?.length || labels?.length) ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {species?.map((s) => (
              <Badge key={`sp-${s}`} variant="green">
                {s}
              </Badge>
            ))}
            {labels?.map((l) => (
              <Badge key={`lb-${l}`} variant="terra">
                {l}
              </Badge>
            ))}
          </div>
        ) : null}

        <p className="mt-1 text-xs font-medium text-terroir-green-700">
          {productCount} produit{productCount > 1 ? "s" : ""} disponible
          {productCount > 1 ? "s" : ""}
        </p>
      </div>
    </article>
  );
}
