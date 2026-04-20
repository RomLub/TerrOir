"use client";

import { useState } from "react";

export type StarRatingProps = {
  value: number;
  max?: number;
  onChange?: (value: number) => void;
  size?: "sm" | "md" | "lg";
  readOnly?: boolean;
  showValue?: boolean;
  className?: string;
};

const sizeClass: Record<NonNullable<StarRatingProps["size"]>, string> = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-xl",
};

export function StarRating({
  value,
  max = 5,
  onChange,
  size = "md",
  readOnly,
  showValue,
  className = "",
}: StarRatingProps) {
  const [hover, setHover] = useState<number | null>(null);
  const interactive = !readOnly && typeof onChange === "function";
  const displayed = hover ?? value;

  return (
    <div
      className={`inline-flex items-center gap-1 ${sizeClass[size]} ${className}`}
      role={interactive ? "radiogroup" : "img"}
      aria-label={`Note ${value} sur ${max}`}
    >
      {Array.from({ length: max }, (_, i) => i + 1).map((i) => {
        const filled = i <= displayed;
        const Star = (
          <span
            aria-hidden
            className={filled ? "text-terroir-terra-700" : "text-terroir-border"}
          >
            ★
          </span>
        );
        if (!interactive) return <span key={i}>{Star}</span>;
        return (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={value === i}
            aria-label={`${i} sur ${max}`}
            className="leading-none focus:outline-none focus:ring-2 focus:ring-terroir-green-700 rounded"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onChange?.(i)}
          >
            {Star}
          </button>
        );
      })}
      {showValue ? (
        <span className="ml-1 text-xs text-terroir-muted">
          {value.toFixed(1)}
        </span>
      ) : null}
    </div>
  );
}
