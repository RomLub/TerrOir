// Squelettes de la zone de contenu /compte/*, partagés par les <Suspense> de
// chaque page (streaming — lot B perf). La navbar, la sidebar et le footer
// sont rendus par (consumer)/compte/layout.tsx ; ces squelettes ne couvrent
// QUE le contenu pour qu'une navigation entre pages /compte/* garde le shell
// fixe et n'anime que le contenu. Server components purs.

// Liste de cartes (commandes, avis, moyens de paiement…).
function CardListSkeleton({ rows = 4 }: { rows?: number }) {
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

// Squelette « titre + liste » — pour les pages dont le titre dépend des
// données (compte d'accueil, mes-avis) et où tout le contenu est en attente.
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="space-y-3">
        <div className="h-8 w-1/2 max-w-xs animate-pulse rounded-md bg-dark/10" />
        <div className="h-4 w-1/3 max-w-xs animate-pulse rounded-md bg-dark/10" />
      </div>
      <CardListSkeleton rows={rows} />
    </div>
  );
}

// Bloc de contenu seul (sans titre) — pour les pages dont l'en-tête est rendu
// de façon synchrone et où seul le contenu sous le titre est en attente.
export function SectionSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <CardListSkeleton rows={rows} />
    </div>
  );
}
