// Squelettes de la zone de contenu admin, partagés par les <Suspense> de
// chaque page (streaming — lot B perf). Le header + la sidebar admin sont
// rendus par (admin)/layout.tsx ; ces squelettes ne couvrent QUE la zone de
// contenu pour qu'une navigation entre pages admin garde le shell fixe et
// n'anime que le contenu. Server components purs.

// Bloc « titre de page » (eyebrow + h1 + sous-titre).
function HeaderSkeleton() {
  return (
    <div className="mb-8 space-y-2">
      <div className="h-3 w-24 animate-pulse rounded bg-dark/10" />
      <div className="h-8 w-1/2 max-w-sm animate-pulse rounded-md bg-dark/10" />
      <div className="h-4 w-1/3 max-w-xs animate-pulse rounded-md bg-dark/10" />
    </div>
  );
}

// Tableau générique (lignes avatar + 2 lignes texte + badge) — reprend le
// rendu de l'ancien (admin)/loading.tsx plein contenu.
function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 p-4">
        <div className="h-4 w-1/4 animate-pulse rounded bg-dark/10" />
      </div>
      <div className="divide-y divide-gray-100">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 p-4">
            <div className="h-8 w-8 animate-pulse rounded-full bg-dark/10" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-2/3 animate-pulse rounded bg-dark/10" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-dark/10" />
            </div>
            <div className="h-6 w-20 animate-pulse rounded-full bg-dark/10" />
          </div>
        ))}
      </div>
    </div>
  );
}

// Squelette « titre + tableau » — pour les pages dont le titre est rendu par
// le contenu streamé (la plupart des listes admin).
export function ListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <HeaderSkeleton />
      <TableSkeleton rows={rows} />
    </div>
  );
}

// Bloc de contenu seul (sans titre) — pour les pages dont l'AdminPageHeader
// est rendu de façon synchrone et où seul le contenu est en attente.
export function SectionSkeleton({ rows = 8 }: { rows?: number }) {
  return <TableSkeleton rows={rows} />;
}

// Dashboard admin : KPIs (grille de cartes) + cockpit + tableau d'activité.
export function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <HeaderSkeleton />
      <div className="mb-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
          >
            <div className="space-y-3">
              <div className="h-3 w-1/2 animate-pulse rounded bg-dark/10" />
              <div className="h-8 w-2/3 animate-pulse rounded bg-dark/10" />
            </div>
          </div>
        ))}
      </div>
      <TableSkeleton rows={6} />
    </div>
  );
}
