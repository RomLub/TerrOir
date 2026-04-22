// Carte métrique (Phase C.2 consolidation admin). Extrait le pattern
// eyebrow uppercase + big number font-serif tabular-nums + hint
// utilisé par suivi-commandes (MetricCard local, 3 cartes) et par la
// pastille "En attente" du header avis.
//
// Deux tailles :
//  - md (défaut) : p-6, label gauche, value 36px, hint sous le nombre
//    — adapté aux grilles de KPI (suivi-commandes).
//  - sm : px-5 py-4, text-center, value 40px (emphase sur le nombre),
//    sans hint — adapté à une pastille de header (avis).

export type MetricCardProps = {
  label: string;
  value: string | number;
  hint?: string;
  size?: "sm" | "md";
};

const SIZE_STYLE: Record<
  "sm" | "md",
  { wrapper: string; eyebrow: string; value: string; hint: string }
> = {
  sm: {
    wrapper:
      "rounded-md border border-gray-200 bg-white px-5 py-4 text-center shadow-sm",
    eyebrow:
      "text-[11px] font-semibold uppercase tracking-[0.14em] text-terroir-green-700",
    value:
      "mt-1 font-serif text-[40px] leading-none tabular-nums text-gray-900",
    hint: "mt-1 text-[12px] text-gray-500",
  },
  md: {
    wrapper: "rounded-md border border-gray-200 bg-white p-6 shadow-sm",
    eyebrow:
      "text-[11px] font-semibold uppercase tracking-[0.18em] text-terroir-green-700",
    value:
      "mt-2 font-serif text-[36px] leading-none tabular-nums text-gray-900",
    hint: "mt-2 text-[12px] text-gray-500",
  },
};

export function MetricCard({
  label,
  value,
  hint,
  size = "md",
}: MetricCardProps) {
  const s = SIZE_STYLE[size];
  return (
    <div className={s.wrapper}>
      <div className={s.eyebrow}>{label}</div>
      <div className={s.value}>{value}</div>
      {hint && <div className={s.hint}>{hint}</div>}
    </div>
  );
}
