import type { HTMLAttributes } from "react";

export type BadgeVariant =
  | "green"
  | "terra"
  | "blue"
  | "neutral"
  | "gray"
  | "danger";

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
  tone?: BadgeVariant;
};

const variantStyles: Record<BadgeVariant, string> = {
  green: "bg-terroir-green-100 text-terroir-green-700",
  terra: "bg-terroir-terra-100 text-terroir-terra-700",
  blue: "bg-blue-100 text-blue-700",
  neutral: "bg-white text-terroir-ink border border-terroir-border",
  gray: "bg-terroir-border/60 text-terroir-ink/80",
  danger: "bg-red-100 text-red-700",
};

export function Badge({
  variant,
  tone,
  className = "",
  ...props
}: BadgeProps) {
  const v: BadgeVariant = variant ?? tone ?? "green";
  const base =
    "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium";
  return (
    <span className={`${base} ${variantStyles[v]} ${className}`} {...props} />
  );
}
