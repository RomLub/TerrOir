// Skeleton fiche producer — hero + bloc identité + galerie + grille produits.
// Streamable pendant fetchPublicProducerBySlug + queries products/reviews.
export default function ProducerSlugLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <section className="mx-auto max-w-7xl px-6 py-12 md:py-16">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr]">
          <div className="aspect-16/10 w-full animate-pulse rounded-2xl bg-terroir-green-100" />
          <div className="space-y-5">
            <div className="h-4 w-32 animate-pulse rounded bg-dark/10" />
            <div className="h-12 w-3/4 animate-pulse rounded bg-dark/10" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-dark/10" />
            <div className="space-y-2 pt-4">
              <div className="h-3 w-full animate-pulse rounded bg-dark/10" />
              <div className="h-3 w-full animate-pulse rounded bg-dark/10" />
              <div className="h-3 w-5/6 animate-pulse rounded bg-dark/10" />
            </div>
            <div className="flex flex-wrap gap-2 pt-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-6 w-20 animate-pulse rounded-full bg-dark/10" />
              ))}
            </div>
          </div>
        </div>
        <div className="mt-14">
          <div className="mb-4 h-3 w-40 animate-pulse rounded bg-dark/10" />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className={`animate-pulse rounded-xl bg-terroir-green-100 ${
                  i === 0 ? 'md:col-span-2 md:row-span-2 aspect-4/3' : 'aspect-4/3'
                }`}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-dark/[0.04] bg-green-100/40">
        <div className="mx-auto max-w-7xl px-6 py-16 md:py-24">
          <div className="mb-10 space-y-3">
            <div className="h-3 w-32 animate-pulse rounded bg-dark/10" />
            <div className="h-12 w-2/3 max-w-md animate-pulse rounded bg-dark/10" />
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
      </section>
    </div>
  );
}
