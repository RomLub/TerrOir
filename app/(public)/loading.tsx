// Skeleton générique (public) — fallback streamable Next 14 pour toute route
// du segment (public)/. Surchargé par des loading.tsx plus spécifiques (cf.
// produits/loading.tsx, producteurs/[slug]/loading.tsx).
export default function PublicLoading() {
  return (
    <div className="mx-auto max-w-7xl px-8 py-10" aria-busy="true" aria-live="polite">
      <div className="mb-8 space-y-3">
        <div className="h-10 w-2/3 max-w-md animate-pulse rounded-md bg-dark/10" />
        <div className="h-4 w-1/3 max-w-xs animate-pulse rounded-md bg-dark/10" />
      </div>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="overflow-hidden rounded-2xl border border-terroir-border bg-white shadow-sm"
          >
            <div className="aspect-4/3 w-full animate-pulse bg-terroir-green-100" />
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
