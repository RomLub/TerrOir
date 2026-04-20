import { forwardRef, type TextareaHTMLAttributes } from "react";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  error?: string;
  hint?: string;
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    { label, error, hint, id, className = "", rows = 4, ...props },
    ref
  ) {
    const taId = id ?? props.name;
    const describedBy = error ? `${taId}-error` : hint ? `${taId}-hint` : undefined;
    return (
      <div className="flex flex-col gap-1">
        {label ? (
          <label
            htmlFor={taId}
            className="text-sm font-medium text-terroir-ink"
          >
            {label}
          </label>
        ) : null}
        <textarea
          ref={ref}
          id={taId}
          rows={rows}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`w-full rounded-md border border-terroir-border bg-white px-3 py-2 text-sm text-terroir-ink placeholder:text-terroir-muted focus:outline-none focus:ring-2 focus:ring-terroir-green-700 focus:border-terroir-green-700 disabled:cursor-not-allowed disabled:opacity-60 ${
            error ? "border-red-500 focus:ring-red-500 focus:border-red-500" : ""
          } ${className}`}
          {...props}
        />
        {error ? (
          <p id={`${taId}-error`} className="text-xs text-red-600">
            {error}
          </p>
        ) : hint ? (
          <p id={`${taId}-hint`} className="text-xs text-terroir-muted">
            {hint}
          </p>
        ) : null}
      </div>
    );
  }
);
