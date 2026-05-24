"use client";

import type { ReactElement, ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo, RoleSwitcher } from "@/components/ui";
import { useUserContext } from "@/components/providers/user-provider";
import type { ProducerNavBadges } from "@/lib/producers/nav-badges";

// Sidebar de l'espace producteur (ADR-0011). Même squelette que la sidebar
// admin (nav déclarative groupée + isActive + badges serveur), peau chaude
// (vert-900 / terre) propre au producteur. Conserve le chrome producteur que
// l'admin n'a pas : logo en tête, RoleSwitcher + bloc identité (lien fiche
// publique) en pied — porté depuis l'ancien `ProducerLayout`.

type BadgeKey = keyof ProducerNavBadges;

type NavItem = {
  kind: "item";
  href: string;
  label: string;
  icon: ReactElement;
  badgeKey?: BadgeKey;
};
type NavGroup = { kind: "group"; label: string };
type NavEntry = NavItem | NavGroup;

// Icônes lucide-like (stroke 2, viewBox 24, h-4 w-4), cohérentes avec la
// sidebar admin. `currentColor` → la couleur est portée par le parent.
function Ic({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      {children}
    </svg>
  );
}

const NAV: NavEntry[] = [
  {
    kind: "item",
    href: "/dashboard",
    label: "Tableau de bord",
    icon: (
      <Ic>
        <rect x="3" y="3" width="7" height="9" />
        <rect x="14" y="3" width="7" height="5" />
        <rect x="14" y="12" width="7" height="9" />
        <rect x="3" y="16" width="7" height="5" />
      </Ic>
    ),
  },

  { kind: "group", label: "Ventes" },
  {
    kind: "item",
    href: "/commandes",
    label: "Commandes",
    badgeKey: "ordersToConfirm",
    icon: (
      <Ic>
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
        <line x1="3" y1="6" x2="21" y2="6" />
        <path d="M16 10a4 4 0 0 1-8 0" />
      </Ic>
    ),
  },
  {
    kind: "item",
    href: "/creneaux",
    label: "Créneaux",
    icon: (
      <Ic>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </Ic>
    ),
  },
  {
    kind: "item",
    href: "/mes-avis",
    label: "Avis",
    icon: (
      <Ic>
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </Ic>
    ),
  },

  { kind: "group", label: "Ma boutique" },
  {
    kind: "item",
    href: "/catalogue",
    label: "Catalogue",
    icon: (
      <Ic>
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </Ic>
    ),
  },
  {
    kind: "item",
    href: "/alertes-stock",
    label: "Alertes stock",
    badgeKey: "stockRuptures",
    icon: (
      <Ic>
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </Ic>
    ),
  },
  {
    kind: "item",
    href: "/ma-page",
    label: "Ma page",
    icon: (
      <Ic>
        <path d="M3 9l1-5h16l1 5" />
        <path d="M4 9v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9" />
        <path d="M9 21v-6h6v6" />
      </Ic>
    ),
  },

  { kind: "group", label: "Finances" },
  {
    kind: "item",
    href: "/revenus",
    label: "Revenus",
    icon: (
      <Ic>
        <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
        <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
        <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
      </Ic>
    ),
  },
  {
    kind: "item",
    href: "/comptabilite",
    label: "Comptabilité",
    icon: (
      <Ic>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="9" y1="13" x2="15" y2="13" />
        <line x1="9" y1="17" x2="13" y2="17" />
      </Ic>
    ),
  },

  { kind: "group", label: "Pilotage" },
  {
    kind: "item",
    href: "/parametres",
    label: "Paramètres",
    icon: (
      <Ic>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </Ic>
    ),
  },
];

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  const path = href.split("?")[0];
  return pathname === path || pathname.startsWith(`${path}/`);
}

export type ProducerSidebarProps = {
  badges?: ProducerNavBadges;
};

export function ProducerSidebar({ badges }: ProducerSidebarProps = {}) {
  const pathname = usePathname();
  const { producer, loading } = useUserContext();

  const badgeValues: ProducerNavBadges = {
    ordersToConfirm: badges?.ordersToConfirm ?? 0,
    stockRuptures: badges?.stockRuptures ?? 0,
  };

  return (
    <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col bg-green-900 text-white">
      <div className="border-b border-white/10 p-6">
        <Logo variant="mono" />
        <div className="mt-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-terra-300">
          Espace Producteur
        </div>
      </div>

      <nav
        aria-label="Navigation producteur"
        className="flex-1 overflow-y-auto p-3"
      >
        <ul className="flex flex-col space-y-0.5">
          {NAV.map((entry, idx) => {
            if (entry.kind === "group") {
              return (
                <li
                  key={`group-${idx}`}
                  role="presentation"
                  className="mt-4 border-t border-white/10 px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-terra-300"
                >
                  {entry.label}
                </li>
              );
            }
            const active = isActive(pathname, entry.href);
            const badgeCount = entry.badgeKey ? badgeValues[entry.badgeKey] : 0;
            return (
              <li key={entry.href}>
                <Link
                  href={entry.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex h-10 items-center gap-3 rounded-lg px-3 text-[14px] transition-colors ${
                    active
                      ? "bg-terra-700 font-semibold text-white"
                      : "text-white/75 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <span className={active ? "text-white" : "text-terra-300"}>
                    {entry.icon}
                  </span>
                  <span className="flex-1">{entry.label}</span>
                  {badgeCount > 0 ? (
                    <span
                      aria-label={`${badgeCount} à traiter`}
                      className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-terra-300 px-1.5 text-[11px] font-semibold text-green-900"
                    >
                      {badgeCount > 99 ? "99+" : badgeCount}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-white/10 p-3">
        <RoleSwitcher current="producer" variant="dark" />
      </div>
      <div className="border-t border-white/10 p-4">
        {producer ? (
          <>
            <div className="font-serif text-[18px] leading-tight">
              {producer.nom_exploitation}
            </div>
            {producer.statut === "public" && producer.slug ? (
              <Link
                href={`/producteurs/${producer.slug}`}
                className="mt-1 inline-block text-[12px] text-terra-300 hover:text-white"
              >
                ↗ Voir ma page publique
              </Link>
            ) : (
              <div className="mt-1 text-[12px] text-terra-300/60">
                Page publique après 1er produit
              </div>
            )}
          </>
        ) : loading ? (
          <div className="font-serif text-[18px] leading-tight text-white/40">
            —
          </div>
        ) : null}
      </div>
    </aside>
  );
}
