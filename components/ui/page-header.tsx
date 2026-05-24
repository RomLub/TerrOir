import type { ReactNode } from "react";

// Header partagé des pages (admin + producteur). Généralise l'ancien
// AdminPageHeader (Phase B4) lors de la refonte de l'espace producteur
// (ADR-0011) : même DOM et mêmes slots (eyebrow + title serif 40px + subtitle
// + error + slot libre `right`), seule la palette change via `tone` —
// « même squelette, peau différente ».
//
// - tone="admin"    : skin gris / vert terroir (back-office).
// - tone="producer" : skin chaud vert-900 / terre (boutique producteur).
//
// `admin-page-header.tsx` reste un ré-export figé sur tone="admin" → zéro
// churn sur les pages admin existantes.
//
// `items-end` (pas `items-start`) : aligne le bas du bouton/pastille `right`
// avec le bas du bloc texte.

export type PageHeaderTone = "admin" | "producer";

const TONE_CLASSES: Record<
  PageHeaderTone,
  { eyebrow: string; title: string; subtitle: string; error: string; margin: string }
> = {
  admin: {
    eyebrow: "text-terroir-green-700",
    title: "text-gray-900",
    subtitle: "text-gray-500",
    error: "text-red-700",
    margin: "mb-8",
  },
  producer: {
    eyebrow: "text-terra-700",
    title: "text-green-900",
    subtitle: "text-dark/60",
    error: "text-terra-700",
    margin: "mb-10",
  },
};

export type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  error?: string | null;
  tone?: PageHeaderTone;
};

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  right,
  error,
  tone = "admin",
}: PageHeaderProps) {
  const c = TONE_CLASSES[tone];
  return (
    <header
      className={`${c.margin} flex flex-wrap items-end justify-between gap-4`}
    >
      <div>
        {eyebrow && (
          <div
            className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${c.eyebrow}`}
          >
            {eyebrow}
          </div>
        )}
        <h1 className={`mt-1 font-serif text-[40px] leading-tight ${c.title}`}>
          {title}
        </h1>
        {subtitle && <p className={`mt-1 text-[14px] ${c.subtitle}`}>{subtitle}</p>}
        {error && <p className={`mt-2 text-[13px] ${c.error}`}>{error}</p>}
      </div>
      {right}
    </header>
  );
}
