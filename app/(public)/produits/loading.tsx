// Skeleton dédié /produits — fidèle à la grille catalogue ProductCard.
// Streamable pendant fetchPublicProducts (force-dynamic) pour éviter la
// page blanche qui était le constat de l'audit Vercel C-3.
export default function ProduitsLoading() {
  return (
    <div className="mx-auto max-w-7xl px-8 py-10" aria-busy="true" aria-live="polite">
      <header className="mb-8 space-y-3">
        <div className="h-10 w-72 max-w-full animate-pulse rounded-md bg-dark/10" />
        <div className="h-4 w-48 animate-pulse rounded-md bg-dark/10" />
      </header>
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
