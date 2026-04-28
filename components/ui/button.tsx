import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Bouton sémantique aligné DS terra-primary (cf. design_system_cards/buttons.html).
 *
 * - `primary`   : terra-700 filled — CTA métier (Ajouter au panier, Commander,
 *                 Payer, S'inscrire, Devenir producteur, Explorer…). Default.
 * - `secondary` : terra-100/terra-700 — action secondaire (Voir mes commandes,
 *                 Itinéraire, Voir plus d'avis…).
 * - `ghost`     : transparent/terra-700 — action tertiaire (Réinitialiser,
 *                 Annuler dans un form, etc.).
 * - `success`   : green-700 filled — validation métier explicite (Confirmer la
 *                 commande, Marquer livrée, Approuver, Publier).
 * - `accent`    : @deprecated — green-700 filled. Variant transitional pour
 *                 back-compat dashboards admin/producer pendant la migration
 *                 sémantique terra. À reclasser en Phase 2 vers `primary`,
 *                 `success`, ou `secondary` selon la sémantique métier réelle
 *                 du call site.
 */
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "success"
  | "accent";
export type ButtonSize = "sm" | "md" | "lg";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-terra-700 text-white hover:bg-terra-800 disabled:bg-terra-700/50",
  secondary:
    "bg-terra-100 text-terra-700 hover:bg-terra-100/70",
  ghost:
    "bg-transparent text-terra-700 hover:bg-terra-100",
  success:
    "bg-green-700 text-white hover:bg-green-800 disabled:bg-green-700/50",
  accent:
    "bg-green-700 text-white hover:bg-green-700/90 disabled:bg-green-700/50",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
  lg: "px-5 py-3 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center rounded-md font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-terra-700 disabled:cursor-not-allowed disabled:opacity-60";
  return (
    <button
      className={cn(base, variantStyles[variant], sizeStyles[size], className)}
      {...props}
    />
  );
}
