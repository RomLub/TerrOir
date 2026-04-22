"use client";

// Barre de tabs filtres partagée (Phase B3 consolidation admin). Extrait
// le pattern underline-tabs + count-pill utilisé par gestion-producteurs
// et producer-interests (FILTERS.map inline quasi-identique). Le style
// pills verts de suivi-commandes reste séparé — divergence intentionnelle
// conservée, même logique que la décision OrderStatusBadge (B1).

export type FilterTabOption<T extends string> = {
  value: T;
  label: string;
};

export type FilterTabsProps<T extends string> = {
  filters: ReadonlyArray<FilterTabOption<T>>;
  counts: Record<T, number>;
  active: T;
  onChange: (value: T) => void;
  className?: string;
};

export function FilterTabs<T extends string>({
  filters,
  counts,
  active,
  onChange,
  className,
}: FilterTabsProps<T>) {
  return (
    <div className={className ?? "flex flex-wrap gap-1.5"}>
      {filters.map((f) => {
        const isActive = active === f.value;
        return (
          <button
            key={f.value}
            onClick={() => onChange(f.value)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-3 text-[14px] font-medium transition-colors ${
              isActive
                ? "border-terroir-green-700 text-gray-900"
                : "border-transparent text-gray-600 hover:text-gray-900"
            }`}
          >
            {f.label}
            <span
              className={`rounded px-1.5 font-mono text-[11px] ${
                isActive
                  ? "bg-terroir-green-100 text-terroir-green-700"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              {counts[f.value]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
