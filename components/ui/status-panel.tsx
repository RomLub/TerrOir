import type { ReactNode } from "react";

// Card de statut pleine largeur (Phase C.1 consolidation admin).
// Extrait le pattern div-based "rounded-md border bg-white shadow-sm +
// contenu centré" répété par producer-interests (loading + empty
// dans LeadsTable) et avis (loading + success-empty "Tout est à jour").
//
// Complément à <TableStatus> (B5) qui cible le pattern <tr><td colSpan>
// utilisé à l'intérieur d'un <tbody>.
//
// Quand `icon` est fourni, le label est rendu en h3 font-serif 24px
// (pattern "success-empty" avec check visuel + heading). Sinon label
// est rendu en simple texte gray-500 centré (pattern loading/empty).

export type StatusPanelProps = {
  kind: "loading" | "empty" | "success-empty";
  label: string;
  subtitle?: string;
  icon?: ReactNode;
  className?: string;
};

export function StatusPanel({
  label,
  subtitle,
  icon,
  className,
}: StatusPanelProps) {
  return (
    <div
      className={
        className ??
        "rounded-md border border-gray-200 bg-white px-5 py-12 text-center shadow-sm"
      }
    >
      {icon && <div className="flex justify-center">{icon}</div>}
      {icon ? (
        <h3 className="mt-4 font-serif text-[24px] text-gray-900">{label}</h3>
      ) : (
        <div className="text-[14px] text-gray-500">{label}</div>
      )}
      {subtitle && (
        <p className="mt-1 text-[14px] text-gray-500">{subtitle}</p>
      )}
    </div>
  );
}
