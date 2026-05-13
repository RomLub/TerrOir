import Link from "next/link";

// Card cockpit Zone 1 — variant du MetricCard avec compteur actionnable :
//   - count > 0 : link cliquable vers la page domaine (refunds, disputes…)
//   - count = 0 : opacité réduite, span (pas de link) pour signal visuel "rien à faire"
//   - href = '#' : link disabled avec tooltip "À venir" (page domaine pas
//     encore livrée en PR2 — disputes/refund-incidents/invitations seront en PR3).
//
// Pas de MetricCard direct car on a besoin du wrapper Link + état tooltip
// disabled, et MetricCard est volontairement minimal pour rester réutilisable
// ailleurs (suivi-commandes, audit-logs stats).

export type CockpitCardProps = {
  label: string;
  count: number;
  hint?: string;
  href: string;
  // Si true, le link est rendu en span title-tooltip (page pas encore livrée).
  pending?: boolean;
};

export function CockpitCard({
  label,
  count,
  hint,
  href,
  pending = false,
}: CockpitCardProps) {
  const isZero = count === 0;
  const opacityClass = isZero ? "opacity-50" : "";
  const baseClass =
    `block rounded-md border border-gray-200 bg-white p-6 shadow-sm transition-colors ${opacityClass}`;

  const content = (
    <>
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-terroir-green-700">
        {label}
      </div>
      <div className="mt-2 font-serif text-[36px] leading-none tabular-nums text-gray-900">
        {count}
      </div>
      {hint && <div className="mt-2 text-[12px] text-gray-500">{hint}</div>}
    </>
  );

  if (pending) {
    return (
      <span
        title="Page à venir"
        className={`${baseClass} cursor-not-allowed`}
        aria-disabled="true"
      >
        {content}
      </span>
    );
  }

  return (
    <Link
      href={href}
      className={`${baseClass} hover:border-gray-300 hover:bg-gray-50`}
    >
      {content}
    </Link>
  );
}
