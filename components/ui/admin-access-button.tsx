"use client";

import { useActionState } from "react";
import {
  requestAdminMagicLinkAction,
  type MagicLinkState,
} from "@/app/connexion/actions";

// Chantier 1 — bouton « Espace admin » affiché sur www UNIQUEMENT pour les
// admins (cf. navbar-public, gardé par isAdmin). Au clic : envoie un magic link
// admin auto à l'adresse de la session (callback sur admin.* → cookie isolé
// sb-admin-auth-token). Pas de partage de cookie cross-subdomain.

function ShieldIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

export function AdminAccessButton({ className = "" }: { className?: string }) {
  const [state, action, pending] = useActionState<MagicLinkState, FormData>(
    requestAdminMagicLinkAction,
    {},
  );

  if (state.message) {
    return (
      <span
        role="status"
        className="text-xs text-terra-700 max-w-[12rem] leading-snug"
      >
        ✓ {state.message}
      </span>
    );
  }

  return (
    <form action={action} className="inline-flex flex-col">
      <button
        type="submit"
        disabled={pending}
        className={`inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-terroir-ink transition-colors hover:bg-terra-100 hover:text-terra-700 disabled:opacity-50 ${className}`}
      >
        <ShieldIcon className="h-5 w-5 text-terra-700" />
        {pending ? "Envoi…" : "Espace admin"}
      </button>
      {state.error ? (
        <span className="mt-0.5 text-xs text-red-600">{state.error}</span>
      ) : null}
    </form>
  );
}
