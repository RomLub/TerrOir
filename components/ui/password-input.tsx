"use client";

import { forwardRef, useState, type InputHTMLAttributes } from "react";

// Labels a11y exposés pour tests data-invariant (vitest env=node, pas de RTL).
// La fonction getPasswordToggleLabel() encapsule la logique de bascule pour
// permettre de tester la discrimination show/hide sans renderer React.
export const PASSWORD_TOGGLE_LABEL_SHOW = "Afficher le mot de passe";
export const PASSWORD_TOGGLE_LABEL_HIDE = "Masquer le mot de passe";

export function getPasswordToggleLabel(visible: boolean): string {
  return visible ? PASSWORD_TOGGLE_LABEL_HIDE : PASSWORD_TOGGLE_LABEL_SHOW;
}

const ICON_PROPS = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function EyeIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

export type PasswordInputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  error?: string;
  hint?: string;
};

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput(
    { label, error, hint, id, className = "", ...props },
    ref,
  ) {
    const [visible, setVisible] = useState(false);
    const inputId = id ?? props.name;
    const describedBy = error
      ? `${inputId}-error`
      : hint
        ? `${inputId}-hint`
        : undefined;
    const toggleLabel = getPasswordToggleLabel(visible);

    return (
      <div className="flex flex-col gap-1">
        {label ? (
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-terroir-ink"
          >
            {label}
          </label>
        ) : null}
        <div className="relative">
          <input
            ref={ref}
            id={inputId}
            type={visible ? "text" : "password"}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={`w-full rounded-md border border-terroir-border bg-white px-3 py-2 pr-10 text-sm text-terroir-ink placeholder:text-terroir-muted focus:outline-none focus:ring-2 focus:ring-terra-700 focus:border-terra-700 disabled:cursor-not-allowed disabled:opacity-60 ${
              error
                ? "border-red-500 focus:ring-red-500 focus:border-red-500"
                : ""
            } ${className}`}
            {...props}
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={toggleLabel}
            aria-pressed={visible}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-terroir-muted hover:text-terra-700 focus:outline-none focus:ring-2 focus:ring-terra-700 focus:ring-offset-1"
          >
            {visible ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>
        {error ? (
          <p id={`${inputId}-error`} className="text-xs text-red-600">
            {error}
          </p>
        ) : hint ? (
          <p id={`${inputId}-hint`} className="text-xs text-terroir-muted">
            {hint}
          </p>
        ) : null}
      </div>
    );
  },
);
