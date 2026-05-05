// Skeleton générique segment (consumer)/ — utilisé par toute route /compte/*
// pendant la résolution session + queries Supabase.
//
// Note : (consumer)/layout.tsx est un simple wrapper, et compte/layout.tsx
// monte NavbarPublic/Footer/Sidebar. Ce skeleton est volontairement minimal
// — la sidebar et la navbar sont rendues par le layout SSR, donc seul le
// contenu interne ({children}) est en attente.
export default function ConsumerLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="space-y-3">
        <div className="h-8 w-1/2 max-w-xs animate-pulse rounded-md bg-dark/10" />
        <div className="h-4 w-1/3 max-w-xs animate-pulse rounded-md bg-dark/10" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
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
  );
}
