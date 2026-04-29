"use client";

import Link from "next/link";
import { useUserContext } from "@/components/providers/user-provider";
import { getRoleSwitcherUrls } from "@/lib/auth/role-switcher-urls";

// Switcher cross-subdomain pour les users ayant les deux casquettes
// consumer ET producer (Chantier 6). Rendu uniquement si les deux rôles
// sont présents — sinon null (pas de placeholder, pas de section vide).
// Gating + URLs factorisés dans lib/auth/role-switcher-urls.ts.
//
// Le bouton du space courant est un <div role="group"> non-cliquable
// avec aria-current="page" pour les lecteurs d'écran. L'autre est un
// <Link> avec URL absolue vers l'autre sous-domaine → hard navigation
// cross-origin, cohérente avec l'isolation de layouts (www vs pro).

export type RoleSwitcherProps = {
  current: "consumer" | "producer";
  variant: "light" | "dark";
};

const STYLES = {
  light: {
    container: "flex flex-col gap-0.5",
    active:
      "block rounded-md px-3 py-2 text-sm font-semibold bg-terroir-green-100 text-terroir-green-700",
    inactive:
      "block rounded-md px-3 py-2 text-sm text-terroir-ink transition-colors hover:bg-terroir-green-100/60 hover:text-terroir-green-700",
  },
  dark: {
    container: "flex flex-col gap-0.5",
    active:
      "block rounded-lg px-3 py-2 text-[14px] font-semibold bg-terra-700 text-white",
    inactive:
      "block rounded-lg px-3 py-2 text-[14px] text-white/75 transition-colors hover:bg-white/5 hover:text-white",
  },
} as const;

export function RoleSwitcher({ current, variant }: RoleSwitcherProps) {
  const { roles } = useUserContext();
  const { show, consumerUrl, producerUrl } = getRoleSwitcherUrls(roles);
  if (!show) return null;

  const s = STYLES[variant];

  return (
    <nav aria-label="Basculer d'espace" className={s.container}>
      {current === "consumer" ? (
        <div aria-current="page" className={s.active}>
          Espace acheteur
        </div>
      ) : (
        <Link href={consumerUrl} className={s.inactive}>
          Espace acheteur
        </Link>
      )}
      {current === "producer" ? (
        <div aria-current="page" className={s.active}>
          Espace producteur
        </div>
      ) : (
        <Link href={producerUrl} className={s.inactive}>
          Espace producteur
        </Link>
      )}
    </nav>
  );
}
