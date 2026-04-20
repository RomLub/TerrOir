"use client";

import { useState } from "react";

export type CodeCommandeProps = {
  code: string;
  label?: string;
  copyable?: boolean;
  className?: string;
};

export function CodeCommande({
  code,
  label = "N° de commande",
  copyable = true,
  className = "",
}: CodeCommandeProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-md border border-terroir-border bg-white px-3 py-1.5 ${className}`}
    >
      <span className="text-xs uppercase tracking-wide text-terroir-muted">
        {label}
      </span>
      <code className="font-mono text-sm text-terroir-ink">{code}</code>
      {copyable ? (
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copier le code de commande"
          className="ml-1 rounded px-1.5 py-0.5 text-xs text-terroir-green-700 hover:bg-terroir-green-100 focus:outline-none focus:ring-2 focus:ring-terroir-green-700"
        >
          {copied ? "Copié" : "Copier"}
        </button>
      ) : null}
    </div>
  );
}
