"use client";

import Link from "next/link";
import { useUserContext } from "@/components/providers/user-provider";
import { NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_PRODUCER_URL } from "@/lib/env/urls";

// Toggle slider cross-subdomain pour les users multi-rôles (consumer ET
// producer présents dans `users.roles`). Variante horizontale du RoleSwitcher
// (sidebars verticales) pour les contextes navbar horizontale (NavbarPublic).
// Rend null si l'user n'a pas les deux rôles → pas de placeholder pour les
// mono-rôle.

export const ROLE_TOGGLE_LABEL_CONSUMER = "Espace acheteur";
export const ROLE_TOGGLE_LABEL_PRODUCER = "Espace producteur";

export type RoleToggleProps = {
  current: "consumer" | "producer";
  className?: string;
};

// Helper pur exposé pour tester la résolution d'URL sans monter le composant.
// `target` = espace cible (pas l'espace courant). URLs absolues pour traverser
// le sous-domaine — cookies session partagés sur .terroir-local.fr (cf.
// lib/supabase/cookie-domain.ts) donc la session est conservée à la bascule.
export function getRoleToggleTargetUrl(
  target: "consumer" | "producer",
): string {
  return target === "consumer"
    ? `${NEXT_PUBLIC_APP_URL}/compte`
    : `${NEXT_PUBLIC_PRODUCER_URL}/dashboard`;
}

export function RoleToggle({ current, className = "" }: RoleToggleProps) {
  const { roles } = useUserContext();
  if (!roles.includes("consumer") || !roles.includes("producer")) return null;

  const consumerUrl = getRoleToggleTargetUrl("consumer");
  const producerUrl = getRoleToggleTargetUrl("producer");

  return (
    <nav
      aria-label="Basculer d'espace"
      className={`relative inline-grid grid-cols-2 items-stretch rounded-full border border-terroir-border bg-terroir-bg p-1 text-xs font-medium ${className}`}
    >
      {/* Curseur slider absolu qui translate selon `current`. Largeur
          calc(50%-0.25rem) = moitié du conteneur moins la moitié du padding
          p-1 de chaque côté → arrête pile au bord interne. translate-x-full
          = sa propre largeur, soit la 2e cellule. */}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute top-1 bottom-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-terra-700 shadow-sm transition-transform duration-200 ease-out ${
          current === "consumer" ? "translate-x-0" : "translate-x-full"
        }`}
      />
      <Link
        href={consumerUrl}
        aria-current={current === "consumer" ? "page" : undefined}
        className={`relative z-10 inline-flex items-center justify-center whitespace-nowrap rounded-full px-3 py-1.5 transition-colors ${
          current === "consumer"
            ? "text-white"
            : "text-terroir-ink hover:text-terra-700"
        }`}
      >
        {ROLE_TOGGLE_LABEL_CONSUMER}
      </Link>
      <Link
        href={producerUrl}
        aria-current={current === "producer" ? "page" : undefined}
        className={`relative z-10 inline-flex items-center justify-center whitespace-nowrap rounded-full px-3 py-1.5 transition-colors ${
          current === "producer"
            ? "text-white"
            : "text-terroir-ink hover:text-terra-700"
        }`}
      >
        {ROLE_TOGGLE_LABEL_PRODUCER}
      </Link>
    </nav>
  );
}
