import Link from "next/link";
import type { ReactNode } from "react";

// Bouton d'action de table admin (Phase C.3 consolidation). Extrait le
// pattern rounded-md + px/py + text-[12|13]px + variantes de couleur
// répété dans gestion-producteurs, avis et LeadsTable.
//
// Deux tailles:
//  - sm (défaut): px-3 py-1.5 text-[12px] — boutons denses en cellule
//    (gestion-producteurs, LeadsTable).
//  - md: px-4 py-2 text-[13px] — boutons plus lisibles en footer de
//    card (avis).
//
// Quand `href` est fourni, le composant rend un <Link> (avec target
// optionnel) au lieu d'un <button>. Utile pour les liens d'action
// partageant la même apparence (ex: "Voir page publique ↗").

export type TableActionButtonVariant =
  | "primary"
  | "ghost"
  | "ghost-danger"
  | "ghost-neutral";

export type TableActionButtonSize = "sm" | "md";

export type TableActionButtonProps = {
  variant: TableActionButtonVariant;
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  target?: string;
  disabled?: boolean;
  title?: string;
  size?: TableActionButtonSize;
};

const SIZE_CLASS: Record<TableActionButtonSize, string> = {
  sm: "px-3 py-1.5 text-[12px]",
  md: "px-4 py-2 text-[13px]",
};

const VARIANT_CLASS: Record<TableActionButtonVariant, string> = {
  primary:
    "bg-terroir-green-700 font-semibold text-white hover:bg-terroir-green-700/90",
  ghost:
    "font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900",
  "ghost-danger": "font-medium text-red-700 hover:bg-red-50",
  "ghost-neutral": "font-medium text-gray-500 hover:text-gray-700",
};

export function TableActionButton({
  variant,
  children,
  onClick,
  href,
  target,
  disabled,
  title,
  size = "sm",
}: TableActionButtonProps) {
  const classes = `rounded-md transition-colors ${SIZE_CLASS[size]} ${VARIANT_CLASS[variant]} disabled:opacity-60`;

  if (href) {
    return (
      <Link href={href} target={target} className={classes} title={title}>
        {children}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={classes}
    >
      {children}
    </button>
  );
}
