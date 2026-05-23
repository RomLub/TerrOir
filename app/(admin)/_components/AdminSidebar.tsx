"use client";

import type { ReactElement } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// T-130 : la sidebar supporte des "group headers" inline en plus des items
// cliquables. Choix retenu : entrées plates groupées avec séparateur + label
// uppercase (la sidebar actuelle est plate, sans support natif du nesting
// collapsible — ajouter un drawer collapsible JS-stateful serait une
// sur-ingénierie).
//
// Chantier 7 : regroupement « Référentiels ». Les référentiels (Prix GMS +
// Catégorisation) sont rassemblés sous un même group header « Référentiels ».
// Comme « Catégorisation » est elle-même une sous-famille (catégories /
// espèces animales / morceaux), on l'exprime avec un sous-en-tête `subgroup`
// indenté — extension minimale du mécanisme de groupes existant, sans état JS.
type NavItem = {
  kind: "item";
  href: string;
  label: string;
  icon: ReactElement;
  // F-014 v2 followup : badge optionnel pour signaler des items actionnables
  // (ex: pending refunds count). Rendu uniquement si > 0.
  badgeKey?: "pendingRefundsCount";
};

type NavGroup = {
  kind: "group";
  label: string;
};

// Chantier 7 : sous-en-tête imbriqué sous un group header (ex: « Catégorisation »
// sous « Référentiels »). Rendu non cliquable, indenté pour marquer le nesting.
type NavSubgroup = {
  kind: "subgroup";
  label: string;
};

type NavEntry = NavItem | NavGroup | NavSubgroup;

const DashboardIcon = (
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
    <rect x="3" y="3" width="7" height="9" />
    <rect x="14" y="3" width="7" height="5" />
    <rect x="14" y="12" width="7" height="9" />
    <rect x="3" y="16" width="7" height="5" />
  </svg>
);

const ProducersIcon = (
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
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const LeadsIcon = (
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
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </svg>
);

const OrdersIcon = (
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
    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
    <line x1="3" y1="6" x2="21" y2="6" />
    <path d="M16 10a4 4 0 0 1-8 0" />
  </svg>
);

const AuditLogsIcon = (
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
    <path d="M15 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="9" y1="13" x2="15" y2="13" />
    <line x1="9" y1="17" x2="13" y2="17" />
  </svg>
);

const ReviewsIcon = (
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
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const GmsPricesIcon = (
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
    <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
    <line x1="7" y1="7" x2="7.01" y2="7" />
  </svg>
);

const ComplianceIcon = (
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
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

// T-130 — icônes pour la section Catégorisation produits.
const CategoryIcon = (
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
    <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
    <line x1="7" y1="7" x2="7.01" y2="7" />
  </svg>
);

const AnimalIcon = (
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
    <path d="M4.5 9a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z" />
    <path d="M19.5 9a2.5 2.5 0 0 0 0-5 2.5 2.5 0 0 0 0 5z" />
    <path d="M8 14a2 2 0 0 1 0-4 2 2 0 0 1 0 4z" />
    <path d="M16 14a2 2 0 0 0 0-4 2 2 0 0 0 0 4z" />
    <path d="M9 17.5C9 19.5 10.5 21 12 21s3-1.5 3-3.5c0-2.5-1.5-4-3-4s-3 1.5-3 3.5z" />
  </svg>
);

const CutIcon = (
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
    <path d="M5.42 9.42 8 12" />
    <circle cx="4" cy="8" r="2" />
    <path d="m14 10-3-3" />
    <circle cx="13" cy="11" r="2" />
    <path d="m22 22-7.28-7.28" />
    <path d="M19 22 9 12" />
  </svg>
);

// F-014 v2 followup — icône horloge pour "Refunds en attente" (signale
// l'action requise par l'admin sur les demandes producer > cap).
const RefundsPendingIcon = (
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
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

// PR3 admin-new-surfaces : icônes pour les 3 nouvelles surfaces (users,
// refund-incidents, invitations). Style cohérent avec les autres icônes
// (lucide-like, stroke 2, viewBox 24x24, h-4 w-4).
const UsersIcon = (
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
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const RefundIncidentsIcon = (
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
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const InvitationsIcon = (
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
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
    <polyline points="22,6 12,13 2,6" />
  </svg>
);

const NAV: NavEntry[] = [
  { kind: "item", href: "/tableau-de-bord", label: "Tableau de bord", icon: DashboardIcon },
  { kind: "item", href: "/producer-interests", label: "Leads producteurs", icon: LeadsIcon },
  { kind: "item", href: "/gestion-producteurs", label: "Gestion producteurs", icon: ProducersIcon },
  { kind: "item", href: "/invitations", label: "Invitations", icon: InvitationsIcon },
  { kind: "item", href: "/users", label: "Utilisateurs", icon: UsersIcon },
  { kind: "item", href: "/suivi-commandes", label: "Suivi commandes", icon: OrdersIcon },
  { kind: "item", href: "/refunds/pending", label: "Refunds en attente", icon: RefundsPendingIcon, badgeKey: "pendingRefundsCount" },
  { kind: "item", href: "/refund-incidents", label: "Incidents refund", icon: RefundIncidentsIcon },
  { kind: "item", href: "/audit-logs", label: "Journal d'audit", icon: AuditLogsIcon },
  { kind: "item", href: "/avis", label: "Avis", icon: ReviewsIcon },
  { kind: "item", href: "/legal-compliance", label: "Conformité légale", icon: ComplianceIcon },
  // ─── Référentiels (chantier 7) ──────────────────────────────────────
  // Regroupe les données de référence : prix GMS + catégorisation produits.
  { kind: "group", label: "Référentiels" },
  { kind: "item", href: "/gms-prices", label: "Données GMS", icon: GmsPricesIcon },
  { kind: "subgroup", label: "Catégorisation produits" },
  { kind: "item", href: "/categorisation/categories", label: "Catégories", icon: CategoryIcon },
  { kind: "item", href: "/categorisation/animaux", label: "Espèces animales", icon: AnimalIcon },
  { kind: "item", href: "/categorisation/morceaux", label: "Morceaux", icon: CutIcon },
];

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

type AdminSidebarProps = {
  // F-014 v2 followup : count pending refunds fetché côté layout server,
  // affiché en badge sur l'item /refunds/pending si > 0.
  pendingRefundsCount?: number;
};

export function AdminSidebar({
  pendingRefundsCount = 0,
}: AdminSidebarProps = {}) {
  const pathname = usePathname();

  const badgeValues: Record<NonNullable<NavItem["badgeKey"]>, number> = {
    pendingRefundsCount,
  };

  return (
    <aside className="sticky top-24 h-fit min-h-[400px] w-[220px] shrink-0 rounded-md border border-gray-200 bg-white shadow-sm">
      <nav aria-label="Navigation back-office" className="py-2">
        <ul className="flex flex-col">
          {NAV.map((entry, idx) => {
            if (entry.kind === "group") {
              return (
                <li
                  key={`group-${idx}`}
                  role="presentation"
                  className="mt-3 border-t border-gray-200 px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-terroir-green-700"
                >
                  {entry.label}
                </li>
              );
            }
            if (entry.kind === "subgroup") {
              // Chantier 7 : sous-en-tête imbriqué (ex: Catégorisation sous
              // Référentiels). Indenté, sans bordure haute, pour marquer le
              // nesting sans casser la continuité visuelle du group parent.
              return (
                <li
                  key={`subgroup-${idx}`}
                  role="presentation"
                  className="px-4 pb-1 pt-2 pl-6 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400"
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
                  className={`flex items-center gap-3 border-l-2 px-4 py-2.5 text-sm transition-colors ${
                    active
                      ? "border-gray-800 bg-gray-100 font-semibold text-gray-900"
                      : "border-transparent font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900"
                  }`}
                >
                  <span className={active ? "text-gray-900" : "text-gray-500"}>
                    {entry.icon}
                  </span>
                  <span className="flex-1">{entry.label}</span>
                  {badgeCount > 0 ? (
                    <span
                      aria-label={`${badgeCount} en attente`}
                      className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-terroir-terra-700 px-1.5 text-[11px] font-semibold text-white"
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
    </aside>
  );
}
