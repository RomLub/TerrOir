"use client";

import { useEffect, useRef, useState } from "react";

// T-241 r4 — Mini-tooltip d'aide au choix dans l'onboarding StepInfos.
// Pattern WAI-ARIA "Disclosure" : un mini-bouton "?" en regard du label
// expose une info-bulle plus détaillée que le HINT court rendu sous le
// radio. Click-to-toggle (pas de hover seul — incohérent mobile, cf.
// décision T-200 r2 sur les pills publiques).
//
// Pourquoi pas de lib externe (Radix Tooltip / Popover) :
//   - aucune dépendance Radix n'est déjà installée dans le repo
//     (cf. package.json) ; ajouter une lib pour 3 boutons d'aide est
//     disproportionné.
//   - le contenu est court, statique, sans positionnement sophistiqué :
//     un panneau absolute + dismiss au clic externe / Escape suffit.
//
// A11y :
//   - bouton trigger : type="button", aria-label dédié ("Aide : ..."),
//     aria-expanded reflète l'état, aria-controls lie au panneau.
//   - panneau : role="tooltip", id stable.
//   - dismiss : clic en dehors (pointerdown global) + touche Escape.
//   - focus : laissé sur le trigger après ouverture (pattern Disclosure
//     standard). Pas de focus trap volontairement — contenu purement
//     informatif, pas d'interactions internes.

export type HelpTooltipProps = {
  /** ID stable utilisé pour le panneau (a11y aria-controls). */
  id: string;
  /**
   * Label aria du bouton trigger. Forme "Aide : <sujet>" pour qu'un
   * screen reader annonce contextuel.
   */
  ariaLabel: string;
  /** Contenu textuel du tooltip. Court (1-3 phrases). */
  children: React.ReactNode;
};

export function HelpTooltip({ id, ariaLabel, children }: HelpTooltipProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (e: PointerEvent) => {
      if (!wrapperRef.current) return;
      if (e.target instanceof Node && wrapperRef.current.contains(e.target)) {
        return;
      }
      setOpen(false);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <span ref={wrapperRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={id}
        // h-6 w-6 = 24px : action secondaire d'aide, pas un CTA. La cible
        // tactile reste utilisable en mobile via le padding visuel + le
        // span englobant le label cliquable (radio entier).
        className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-full border border-gray-300 bg-white text-[12px] font-semibold text-gray-600 hover:border-terroir-green-700 hover:text-terroir-green-700 focus:outline-none focus:ring-2 focus:ring-terroir-green-700"
      >
        <span aria-hidden="true">?</span>
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute left-0 top-7 z-10 w-64 rounded-md border border-gray-200 bg-white p-3 text-[12px] leading-normal text-gray-700 shadow-lg"
        >
          {children}
        </span>
      )}
    </span>
  );
}
