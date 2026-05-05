// Skeleton générique segment (producer)/ — utilisé entre la résolution
// session/host du layout et le rendu des pages dashboard / commandes /
// catalogue / etc. Volontairement simple : pas de sidebar (rendue par
// chaque page via <ProducerLayout>) — uniquement le squelette du contenu
// principal.
export default function ProducerLoading() {
  return (
    <div className="min-h-screen bg-bg" aria-busy="true" aria-live="polite">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <div className="mb-8 space-y-3">
          <div className="h-3 w-32 animate-pulse rounded bg-dark/10" />
          <div className="h-10 w-2/3 max-w-md animate-pulse rounded bg-dark/10" />
        </div>
        <div className="mb-8 grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl border border-terroir-border bg-white p-5 shadow-sm"
            >
              <div className="space-y-3">
                <div className="h-3 w-1/3 animate-pulse rounded bg-dark/10" />
                <div className="h-8 w-1/2 animate-pulse rounded bg-dark/10" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-dark/10" />
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl border border-terroir-border bg-white p-5 shadow-sm"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-2/3 animate-pulse rounded bg-dark/10" />
                  <div className="h-3 w-1/3 animate-pulse rounded bg-dark/10" />
                </div>
                <div className="h-8 w-24 animate-pulse rounded-full bg-dark/10" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
