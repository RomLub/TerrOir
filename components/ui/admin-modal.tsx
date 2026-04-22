"use client";

import { useEffect, type ReactNode } from "react";

// Shell commun aux modals admin (Phase B2 consolidation). Extrait le
// backdrop + card + close handling répété par ConfirmValidateModal,
// InviteModal et DeleteLeadModal. Consommateurs rendent uniquement leur
// contenu (children) + leurs actions (footer) ; le shell gère le backdrop
// blur, le click-outside, Escape, et le bouton close X top-right.

export type AdminModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  eyebrow?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  maxHeight?: boolean;
};

const SIZE_CLASS: Record<"sm" | "md" | "lg", string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
};

export function AdminModal({
  open,
  onClose,
  title,
  eyebrow,
  children,
  footer,
  size = "md",
  maxHeight = true,
}: AdminModalProps) {
  // Escape ferme le modal. Attaché sur window, retiré au démontage ou
  // quand open flip à false pour ne pas capturer d'autres modals.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className={`relative w-full ${SIZE_CLASS[size]} rounded-md border border-gray-200 bg-white p-8 shadow-2xl ${maxHeight ? "max-h-[90vh] overflow-y-auto" : ""}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-modal-title"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          className="absolute right-3 top-3 rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        {eyebrow && (
          <div className="pr-6 text-[11px] font-semibold uppercase tracking-[0.2em] text-terroir-green-700">
            {eyebrow}
          </div>
        )}
        <h2
          id="admin-modal-title"
          className={`pr-6 font-serif text-[24px] leading-tight text-gray-900 ${eyebrow ? "mt-1" : ""}`}
        >
          {title}
        </h2>
        {children}
        {footer && (
          <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-gray-200 pt-5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
