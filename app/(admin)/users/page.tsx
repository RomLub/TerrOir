import Link from "next/link";
import { AdminPageHeader } from "@/components/ui/admin-page-header";
import { Badge } from "@/components/ui/badge";
import { TableStatus } from "@/components/ui/table-status";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseCursor, buildCursorUrl } from "@/lib/pagination/cursor";
import { formatDateFr } from "@/lib/format/date";
import {
  fetchAdminUsersList,
  ADMIN_USERS_PAGE_SIZE,
} from "@/lib/admin/users/fetch";
import type {
  AdminUserRole,
  AdminUserRoleFilter,
} from "@/lib/admin/users/types";
import { UsersListFilters } from "./_components/UsersListFilters";

// Server Component admin /users (PR3 admin-new-surfaces, audit § 6 P2 #9 —
// gap surface users globale). Pattern aligné gestion-producteurs PR1 :
// service_role + Server Component pur + interactions UI déléguées à des
// Server Components / form GET natifs (pas de Client Component pour la liste,
// pas de fetch dynamique côté client).
//
// Visualisation seule (PR3) — pas de WRITE, pas d'audit log.
export const dynamic = "force-dynamic";
export const revalidate = 0;

type SearchParams = {
  before?: string;
  before_id?: string;
  role?: string;
  q?: string;
};

const ROLE_VALUES: AdminUserRoleFilter[] = [
  "all",
  "consumer",
  "producer",
  "admin",
];

function parseRole(raw: string | undefined): AdminUserRoleFilter {
  if (!raw) return "all";
  return (ROLE_VALUES as string[]).includes(raw)
    ? (raw as AdminUserRoleFilter)
    : "all";
}

const ROLE_BADGE: Record<
  AdminUserRole,
  { label: string; variant: "green" | "terra" | "danger" | "gray" }
> = {
  consumer: { label: "Consumer", variant: "gray" },
  producer: { label: "Producteur", variant: "green" },
  admin: { label: "Admin", variant: "danger" },
};

export default async function AdminUsersPage(props: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await props.searchParams;
  const role = parseRole(sp.role);
  const q = (sp.q ?? "").trim();

  const cursor = parseCursor({
    get(name: string) {
      return (sp as Record<string, string | undefined>)[name] ?? null;
    },
  });

  const admin = createSupabaseAdminClient();
  const { rows, total, nextCursor, error } = await fetchAdminUsersList(admin, {
    cursor,
    roleFilter: role,
    q: q || null,
  });

  const isPaginated = cursor.before !== null;
  const subtitle = error
    ? undefined
    : `${total} compte${total > 1 ? "s" : ""} au total`;

  // Construit la base URL des filtres pour les pages suivantes (cursor).
  function buildBaseHref(): string {
    const params = new URLSearchParams();
    if (role !== "all") params.set("role", role);
    if (q) params.set("q", q);
    const qs = params.toString();
    return qs ? `/users?${qs}` : "/users";
  }

  const nextHref = nextCursor
    ? buildCursorUrl(buildBaseHref(), nextCursor)
    : null;

  return (
    <div>
      <AdminPageHeader
        eyebrow="Comptes"
        title="Utilisateurs"
        subtitle={subtitle}
        error={error}
      />

      <UsersListFilters role={role} q={q} />

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-[13px]">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-5 py-3 text-left font-medium text-gray-600">
                Email
              </th>
              <th className="px-5 py-3 text-left font-medium text-gray-600">
                Nom
              </th>
              <th className="px-5 py-3 text-left font-medium text-gray-600">
                Role
              </th>
              <th className="px-5 py-3 text-left font-medium text-gray-600">
                Inscrit le
              </th>
              <th className="px-5 py-3 text-left font-medium text-gray-600">
                Derniere activite
              </th>
              <th className="px-5 py-3 text-left font-medium text-gray-600">
                Commandes
              </th>
              <th className="px-5 py-3 text-right font-medium text-gray-600">
                {/* actions */}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {rows.length === 0 ? (
              <TableStatus
                kind={q || role !== "all" ? "empty-filtered" : "empty"}
                colSpan={7}
                emptyLabel="Aucun utilisateur"
                emptyFilteredLabel="Aucun utilisateur avec ces filtres"
              />
            ) : (
              rows.map((u) => {
                const badge = ROLE_BADGE[u.role];
                return (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 text-gray-900">{u.email}</td>
                    <td className="px-5 py-3 text-gray-700">{u.fullName}</td>
                    <td className="px-5 py-3">
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </td>
                    <td className="px-5 py-3 text-gray-500">{u.joinedAt}</td>
                    <td className="px-5 py-3 text-gray-500">
                      {u.lastSignInAt
                        ? formatDateFr(u.lastSignInAt)
                        : "Jamais connecte"}
                    </td>
                    <td className="px-5 py-3 text-gray-700">
                      {u.ordersCount}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        href={`/users/${u.id}`}
                        className="rounded-md border border-gray-300 bg-white px-3 py-1 text-[12px] font-medium text-gray-700 transition-colors hover:bg-gray-50"
                      >
                        Voir
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <nav className="mt-4 flex items-center justify-between">
        {isPaginated ? (
          <Link
            href={buildBaseHref()}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-[13px] text-gray-700 transition-colors hover:bg-gray-50"
          >
            &larr; Retour debut
          </Link>
        ) : (
          <span />
        )}
        {nextHref ? (
          <Link
            href={nextHref}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-[13px] text-gray-700 transition-colors hover:bg-gray-50"
          >
            Plus ancien &rarr;
          </Link>
        ) : (
          <span />
        )}
      </nav>

      {rows.length >= ADMIN_USERS_PAGE_SIZE && (
        <p className="mt-2 text-[12px] text-gray-400">
          {ADMIN_USERS_PAGE_SIZE} resultats par page
        </p>
      )}
    </div>
  );
}
