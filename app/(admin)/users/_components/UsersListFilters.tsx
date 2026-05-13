import Link from "next/link";
import type { AdminUserRoleFilter } from "@/lib/admin/users/types";

// Filtres de la page admin /users — Server Component pur, pas d'interactivité
// JS-side. Les tabs rôle sont des <Link href="?role=..."> qui déclenchent
// re-fetch côté Server Component parent. La recherche email est un <form>
// natif GET → on profite du soumit clavier sans 'use client'.

const ROLE_TABS: Array<{ value: AdminUserRoleFilter; label: string }> = [
  { value: "all", label: "Tous" },
  { value: "consumer", label: "Consumers" },
  { value: "producer", label: "Producteurs" },
  { value: "admin", label: "Admins" },
];

export function UsersListFilters({
  role,
  q,
}: {
  role: AdminUserRoleFilter;
  q: string;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-4">
      <div
        role="tablist"
        aria-label="Filtrer par role"
        className="flex flex-wrap gap-2"
      >
        {ROLE_TABS.map((tab) => {
          const isActive = tab.value === role;
          // Reset cursor (before/before_id) quand on change de filtre — évite
          // un cursor stale qui pointerait avant un set vide.
          const params = new URLSearchParams();
          if (tab.value !== "all") params.set("role", tab.value);
          if (q) params.set("q", q);
          const href = params.toString()
            ? `/users?${params.toString()}`
            : "/users";
          return (
            <Link
              key={tab.value}
              href={href}
              role="tab"
              aria-selected={isActive}
              data-active={isActive ? "true" : "false"}
              className={
                isActive
                  ? "rounded-full bg-terroir-green-700 px-4 py-1.5 text-[13px] font-medium text-white"
                  : "rounded-full border border-gray-300 bg-white px-4 py-1.5 text-[13px] text-gray-700 transition-colors hover:bg-gray-50"
              }
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      <form method="get" action="/users" className="flex items-center gap-2">
        {role !== "all" && (
          <input type="hidden" name="role" value={role} />
        )}
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Rechercher un email..."
          className="w-64 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-[13px] text-gray-900 placeholder:text-gray-400 focus:border-terroir-green-700 focus:outline-none"
          aria-label="Rechercher un email"
        />
        <button
          type="submit"
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-[13px] text-gray-700 transition-colors hover:bg-gray-50"
        >
          Rechercher
        </button>
        {q && (
          <Link
            href={role !== "all" ? `/users?role=${role}` : "/users"}
            className="text-[13px] text-gray-500 underline-offset-2 hover:underline"
          >
            Effacer
          </Link>
        )}
      </form>
    </div>
  );
}
