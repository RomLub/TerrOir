// Badge statut générique (chantier consolidation admin, Phase B1). Rend le
// pattern "pill colorée + dot + label" partagé par gestion-producteurs,
// suivi-commandes et producer-interests. Les variantes spécialisées
// (ProducerStatusBadge, LeadStatusBadge) consomment ce composant en leur
// passant la palette dérivée de leur propre meta.
//
// OrderStatusBadge existant (producer/consumer) conserve son look no-dot
// via le Badge shared — divergence intentionnelle pour ne pas changer
// visuellement les pages order déjà en prod.

export type StatusDotBadgeProps = {
  label: string;
  bg: string;
  text: string;
  dot: string;
  className?: string;
};

export function StatusDotBadge({
  label,
  bg,
  text,
  dot,
  className = "",
}: StatusDotBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ${bg} ${text} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
