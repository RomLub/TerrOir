// Skeleton fiche produit — mirroir du layout ProductPageClient (breadcrumb +
// grille 2 colonnes : galerie photo à gauche, détails/prix/créneaux à droite).
//
// Perf (latence-navigation 2026-05-24) : la fiche produit reste rendue
// dynamiquement (stock live + génération de créneaux + comptage des
// réservations actives → décision d'achat, pas de cache toléré). Le pattern
// "shell streamé" déporte le fetch bloquant dans un composant async enveloppé
// de <Suspense> ; ce skeleton est le fallback affiché instantanément pendant
// que les données arrivent, à la place de la page blanche (ou du skeleton
// fiche-producteur hérité, à la mauvaise forme).
export function ProductPageSkeleton() {
  return (
    <div className="min-h-screen bg-bg" aria-busy="true" aria-live="polite">
      <nav aria-label="Breadcrumb" className="max-w-7xl mx-auto px-6 pt-6">
        <div className="flex items-center gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-3 w-20 animate-pulse rounded bg-dark/10" />
          ))}
        </div>
      </nav>

      <section className="max-w-7xl mx-auto px-6 py-10">
        <div className="grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-10 lg:gap-14">
          {/* Galerie */}
          <div>
            <div className="aspect-4/3 w-full animate-pulse rounded-2xl bg-terroir-green-100" />
            <div className="mt-3 grid grid-cols-4 gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="aspect-square animate-pulse rounded-xl bg-terroir-green-100"
                />
              ))}
            </div>
          </div>

          {/* Détails */}
          <div className="flex flex-col gap-5">
            <div className="h-3 w-40 animate-pulse rounded bg-dark/10" />
            <div className="h-12 w-3/4 animate-pulse rounded bg-dark/10" />
            <div className="h-10 w-32 animate-pulse rounded bg-dark/10" />
            <div className="flex gap-2">
              <div className="h-6 w-24 animate-pulse rounded-full bg-dark/10" />
              <div className="h-6 w-32 animate-pulse rounded-full bg-dark/10" />
            </div>
            <div className="space-y-2 pt-2">
              <div className="h-3 w-full animate-pulse rounded bg-dark/10" />
              <div className="h-3 w-full animate-pulse rounded bg-dark/10" />
              <div className="h-3 w-5/6 animate-pulse rounded bg-dark/10" />
            </div>
            <div className="pt-2 space-y-3">
              <div className="h-3 w-24 animate-pulse rounded bg-dark/10" />
              <div className="h-12 w-44 animate-pulse rounded-xl bg-dark/10" />
            </div>
            <div className="pt-2 space-y-3">
              <div className="h-3 w-48 animate-pulse rounded bg-dark/10" />
              <div className="h-14 w-full animate-pulse rounded-xl bg-dark/10" />
              <div className="h-14 w-full animate-pulse rounded-xl bg-dark/10" />
            </div>
            <div className="pt-4">
              <div className="h-14 w-full animate-pulse rounded-full bg-dark/10" />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
