// Squelettes de la zone <main> producteur, partagés par les <Suspense> de
// chaque page (streaming — lot B perf). La sidebar est rendue par le layout
// (producer)/layout.tsx ; ces squelettes ne couvrent QUE la zone de contenu
// pour qu'une navigation entre pages sœurs garde la sidebar fixe et n'anime
// que le contenu. Server components purs (aucune interactivité).

// Bloc « titre de page » (eyebrow + h1) — réutilisé en tête des squelettes
// dont le PageHeader n'est pas rendu de façon synchrone par la page.
function HeaderSkeleton() {
  return (
    <div className="mb-8 space-y-3">
      <div className="h-3 w-32 animate-pulse rounded bg-dark/10" />
      <div className="h-10 w-2/3 max-w-md animate-pulse rounded bg-dark/10" />
    </div>
  );
}

// Liste de cartes (commandes, avis, alertes…). `rows` règle la hauteur
// perçue du squelette pour limiter le saut de mise en page à l'arrivée.
function CardListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
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
  );
}

// Dashboard : titre + 3 cartes KPI + liste « à traiter ».
export function DashboardSkeleton() {
  return (
    <div
      className="mx-auto w-full max-w-7xl px-6 py-10"
      aria-busy="true"
      aria-live="polite"
    >
      <HeaderSkeleton />
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
      <CardListSkeleton rows={4} />
    </div>
  );
}

// Listes producteur (commandes, catalogue, avis) — titre + cartes.
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div
      className="mx-auto w-full max-w-7xl px-6 py-10"
      aria-busy="true"
      aria-live="polite"
    >
      <HeaderSkeleton />
      <CardListSkeleton rows={rows} />
    </div>
  );
}

// Bloc de contenu seul (sans titre) — pour les pages dont le PageHeader est
// rendu de façon synchrone et où seul le contenu sous le titre est en attente.
export function SectionSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      <CardListSkeleton rows={rows} />
    </div>
  );
}
