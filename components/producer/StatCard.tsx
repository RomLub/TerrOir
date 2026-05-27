import type { ReactNode } from 'react';

// Carte KPI du dashboard producteur (4 cartes en rangée :
// Commandes / Revenus / Note / Prochain retrait).
//
// Pourquoi un composant distinct de `components/ui/metric-card.tsx` :
// le DS producteur (rounded-2xl, shadow-soft, palette green/terra,
// eyebrow neutre text-dark/55) diverge du DS admin servi par MetricCard.
// Doctrine implicite déjà posée par CockpitCard : MetricCard reste
// minimal, les variantes ont leur composant local. Si un jour les
// chartes admin et producteur convergent, l'unification devra viser
// StatCard + MetricCard + CockpitCard ensemble, pas opportunistement.
//
// Contrat d'alignement embarqué : la rangée de 4 cartes reste
// parfaitement alignée même quand les labels, valeurs ou sub
// varient en longueur :
//   - Titre  : max 2 lignes (line-clamp-2 + min-h pour réserver
//              les 2 lignes même si le label tient sur 1).
//   - Valeur : 1 ligne forcée (truncate), font-serif 36px leading-none.
//   - Sub    : 1 ligne forcée (line-clamp-1), placeholder NBSP en
//              fallback pour préserver la hauteur si sub absent.
//
// Le wrapper utilise grid-rows-[auto_auto_1fr] pour que les 3 zones
// s'empilent à hauteur fixe.

// NBSP (U+00A0) utilisé comme placeholder du sub absent — un espace
// normal serait collapse par les règles HTML whitespace.
const NBSP_PLACEHOLDER = '\u00A0';

export type StatCardProps = {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'green' | 'terra';
};

export function StatCard({
  label,
  value,
  sub,
  tone = 'green',
}: StatCardProps) {
  const valueColor = tone === 'terra' ? 'text-terra-700' : 'text-green-900';

  return (
    <div className="grid grid-rows-[auto_auto_1fr] bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-5">
      <div className="line-clamp-2 min-h-[2.6em] text-[11px] uppercase tracking-[0.12em] text-dark/55 font-semibold leading-tight">
        {label}
      </div>
      <div
        className={`mt-2 truncate font-serif text-[36px] leading-none tabular-nums ${valueColor}`}
      >
        {value}
      </div>
      <div className="mt-1.5 line-clamp-1 min-h-[1.4em] text-[12px] text-dark/55">
        {sub ?? NBSP_PLACEHOLDER}
      </div>
    </div>
  );
}
