// Skeleton générique segment (admin)/. Le layout admin (header + sidebar
// fixes + max-w-7xl wrapper) est SSR — ce loading rend uniquement le
// contenu interne pendant les queries Supabase admin.
export default function AdminLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="space-y-2">
        <div className="h-8 w-1/2 max-w-sm animate-pulse rounded-md bg-dark/10" />
        <div className="h-4 w-1/3 max-w-xs animate-pulse rounded-md bg-dark/10" />
      </div>
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 p-4">
          <div className="h-4 w-1/4 animate-pulse rounded bg-dark/10" />
        </div>
        <div className="divide-y divide-gray-100">
          {Array.from({ length: 8 }).map((_, i) => (
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
    </div>
  );
}
