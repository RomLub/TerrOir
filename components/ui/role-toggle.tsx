"use client";

import Link from "next/link";
import { useUserContext } from "@/components/providers/user-provider";
import { getRoleSwitcherUrls } from "@/lib/auth/role-switcher-urls";

// Toggle slider cross-subdomain pour les users multi-rôles (consumer ET
// producer présents dans `users.roles`). Variante horizontale du RoleSwitcher
// (sidebars verticales) pour les contextes navbar horizontale (NavbarPublic).
// Rend null si l'user n'a pas les deux rôles → pas de placeholder pour les
// mono-rôle. Gating + URLs factorisés dans lib/auth/role-switcher-urls.ts.

export const ROLE_TOGGLE_LABEL_CONSUMER = "Espace acheteur";
export const ROLE_TOGGLE_LABEL_PRODUCER = "Espace producteur";

export type RoleToggleProps = {
  current: "consumer" | "producer";
  className?: string;
};

export function RoleToggle({ current, className = "" }: RoleToggleProps) {
  const { roles } = useUserContext();
  const { show, consumerUrl, producerUrl } = getRoleSwitcherUrls(roles);
  if (!show) return null;

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
