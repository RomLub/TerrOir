"use client";

import Link from "next/link";
import { useUserContext } from "@/components/providers/user-provider";

// Switcher cross-subdomain pour les users ayant les deux casquettes
// consumer ET producer (Chantier 6). Rendu uniquement si les deux rôles
// sont présents — sinon null (pas de placeholder, pas de section vide).
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
  if (!roles.includes("consumer") || !roles.includes("producer")) return null;

  const consumerUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/compte`;
  const producerUrl = `${process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://pro.localhost:3000"}/dashboard`;
  const s = STYLES[variant];

  return (
    <nav aria-label="Basculer d'espace" className={s.container}>
      {current === "consumer" ? (
        <div aria-current="page" className={s.active}>
          Espace consommateur
        </div>
      ) : (
        <Link href={consumerUrl} className={s.inactive}>
          Espace consommateur
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
