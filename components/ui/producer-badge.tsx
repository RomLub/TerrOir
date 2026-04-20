import type { HTMLAttributes } from "react";

export type ProducerBadgeKind =
  | "stock"
  | "response"
  | "reliability"
  | "verified";

export type ProducerBadgeProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  kind: ProducerBadgeKind;
  score?: number;
  label?: string;
};

const kindLabels: Record<ProducerBadgeKind, string> = {
  stock: "Stock",
  response: "Réponse",
  reliability: "Fiabilité",
  verified: "Producteur vérifié",
};

function scoreTone(score: number | undefined): string {
  if (typeof score !== "number") return "bg-white/15 text-white";
  if (score >= 90) return "bg-terroir-green-100 text-terroir-green-700";
  if (score >= 70) return "bg-terroir-terra-100 text-terroir-terra-700";
  return "bg-red-100 text-red-700";
}

export function ProducerBadge({
  kind,
  score,
  label,
  className = "",
  ...props
}: ProducerBadgeProps) {
  const text = label ?? kindLabels[kind];
  const scoreText =
    typeof score === "number" ? ` · ${Math.round(score)}%` : "";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium backdrop-blur ${scoreTone(
        score
      )} ${className}`}
      {...props}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />
      {text}
      {scoreText}
    </span>
  );
}
