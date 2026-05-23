import Link from "next/link";

// Chantier 5 — barre d'onglets de la section « Remboursements ». Les deux
// vues (demandes à arbitrer = /refunds/pending, incidents techniques =
// /refund-incidents) sont fusionnées en une seule section à deux onglets.
// Implémentées comme deux routes (onglets deep-linkables, back-button
// natif) plutôt qu'un état JS — cohérent avec la doctrine T-130 (pas de
// collapsible/tab stateful inutile).
//
// Server Component : l'onglet actif est passé en prop par chaque page (pas
// de usePathname client).
type RefundsTab = "demandes" | "incidents";

const TABS: { key: RefundsTab; href: string; label: string }[] = [
  { key: "demandes", href: "/refunds/pending", label: "Demandes à arbitrer" },
  { key: "incidents", href: "/refund-incidents", label: "Incidents techniques" },
];

export function RefundsTabNav({ active }: { active: RefundsTab }) {
  return (
    <div className="px-6 pt-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-terroir-green-700">
        Remboursements
      </p>
      <nav
        aria-label="Onglets remboursements"
        className="mt-2 flex gap-1 border-b border-gray-200"
      >
        {TABS.map((tab) => {
          const isActive = tab.key === active;
          return (
            <Link
              key={tab.key}
              href={tab.href}
              aria-current={isActive ? "page" : undefined}
              className={`-mb-px border-b-2 px-4 py-2.5 text-sm transition-colors ${
                isActive
                  ? "border-terroir-green-700 font-semibold text-gray-900"
                  : "border-transparent font-medium text-gray-600 hover:text-gray-900"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
