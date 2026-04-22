import type { ReactNode } from "react";

// Header partagé des pages admin (Phase B4 consolidation). Extrait le
// pattern eyebrow uppercase + title font-serif 40px + subtitle gray-500
// répété par gestion-producteurs, producer-interests, avis et
// suivi-commandes. `right` est un slot libre pour actions top-right
// (bouton, pastille, ou custom card).
//
// `items-end` (pas `items-start`) : aligne visuellement le bas du
// bouton/pastille avec le bas du bloc texte — cohérent avec l'existant
// avant extraction.
//
// `error` facultatif : affiché sous le subtitle avec `mt-2` pour
// préserver le placement visuel hérité (toutes les pages migrées
// affichaient un `<p>` d'erreur au même endroit).

export type AdminPageHeaderProps = {
  eyebrow: string;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  error?: string | null;
};

export function AdminPageHeader({
  eyebrow,
  title,
  subtitle,
  right,
  error,
}: AdminPageHeaderProps) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-terroir-green-700">
          {eyebrow}
        </div>
        <h1 className="mt-1 font-serif text-[40px] leading-tight text-gray-900">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-[14px] text-gray-500">{subtitle}</p>
        )}
        {error && (
          <p className="mt-2 text-[13px] text-red-700">{error}</p>
        )}
      </div>
      {right}
    </header>
  );
}
