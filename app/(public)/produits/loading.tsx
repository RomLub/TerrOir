// Fallback de transition de route /produits.
//
// Perf (latence-navigation 2026-05-24) : avec le shell streamé de page.tsx
// (h1 statique instantané + grille streamée derrière <Suspense>), on aligne ce
// loading de route sur le même cadre : le vrai titre s'affiche tout de suite,
// seul le bloc résultats (compteur + grille) est en skeleton. Évite le double
// flash titre-pulse → titre-réel et tout layout shift à la transition.
export default function ProduitsLoading() {
  return (
    <div className="mx-auto max-w-7xl px-8 py-10" aria-busy="true" aria-live="polite">
      <h1 className="mb-2 font-serif text-[40px] text-green-900 leading-tight">
        Tous les produits
      </h1>
      <div className="mb-8 h-4 w-48 animate-pulse rounded-md bg-dark/10" />
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
