import { funnelSteps, FUNNEL_TOTAL_STEPS } from "@/lib/admin/producer-interests/funnel";
import type { LeadSource } from "@/lib/admin/producer-interests/types";

// Frise funnel d'un lead : 6 segments, remplis jusqu'à current_step. Libellés
// distincts prospect/spontané. `compact` = version table (segments seuls +
// libellé étape courante) ; sinon version détail (tous les libellés).

export function LeadFunnel({
  source,
  currentStep,
  abandoned = false,
  compact = false,
}: {
  source: LeadSource;
  currentStep: number;
  abandoned?: boolean;
  compact?: boolean;
}) {
  const steps = funnelSteps(source);
  const current = Math.min(Math.max(currentStep, 1), FUNNEL_TOTAL_STEPS);

  const segColor = (i: number): string => {
    if (abandoned) return "bg-dark/15";
    const n = i + 1;
    if (n < current) return "bg-green-500";
    if (n === current) return "bg-terra-600";
    return "bg-dark/10";
  };

  if (compact) {
    return (
      <div className="flex flex-col gap-1 min-w-[140px]">
        <div className="flex gap-1" aria-hidden="true">
          {steps.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full ${segColor(i)}`}
            />
          ))}
        </div>
        <span className="text-[11px] text-dark/60">
          {abandoned ? "Abandonné" : `${current}/6 · ${steps[current - 1]}`}
        </span>
      </div>
    );
  }

  return (
    <ol className="flex flex-wrap gap-2">
      {steps.map((label, i) => {
        const n = i + 1;
        const done = !abandoned && n < current;
        const isCurrent = !abandoned && n === current;
        return (
          <li
            key={label}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] ${
              isCurrent
                ? "border-terra-600 bg-terra-50 text-terra-800 font-semibold"
                : done
                  ? "border-green-300 bg-green-50 text-green-800"
                  : "border-dark/10 bg-white text-dark/50"
            }`}
          >
            <span className="tabular-nums">{n}</span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}
