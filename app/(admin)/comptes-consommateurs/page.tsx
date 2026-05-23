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
import type { AdminUserRole } from "@/lib/admin/users/types";

// Chantier 5 — page admin « Comptes consommateurs » (section Consommateurs).
// Reprend l'infrastructure /users (fetchAdminUsersList + détail partagé
// /users/[id]) verrouillée sur le set 'consumer_inclusive' : tout compte ayant
// le rôle consommateur, double-rôle producteur+conso inclus (ils apparaissent
// donc ici ET dans /gestion-producteurs). Visualisation seule (pas de WRITE).
//
// Auth gardée par app/(admin)/layout.tsx (redirect /connexion si !isAdmin).
export const dynamic = "force-dynamic";
export const revalidate = 0;

type SearchParams = {
  before?: string;
  before_id?: string;
  q?: string;
};

// Badge de rôle : surface le double-rôle (un compte producteur+conso s'affiche
// « Producteur » — signal utile dans la liste consommateurs).
const ROLE_BADGE: Record<
  AdminUserRole,
  { label: string; variant: "green" | "terra" | "danger" | "gray" }
> = {
  consumer: { label: "Consommateur", variant: "gray" },
  producer: { label: "Aussi producteur", variant: "green" },
  admin: { label: "Admin", variant: "danger" },
};

export default async function AdminComptesConsommateursPage(props: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await props.searchParams;
  const q = (sp.q ?? "").trim();

  const cursor = parseCursor({
    get(name: string) {
      return (sp as Record<string, string | undefined>)[name] ?? null;
    },
  });

  const admin = createSupabaseAdminClient();
  const { rows, total, nextCursor, error } = await fetchAdminUsersList(admin, {
    cursor,
    roleFilter: "consumer_inclusive",
    q: q || null,
  });

  const isPaginated = cursor.before !== null;
  const subtitle = error
    ? undefined
    : `${total} compte${total > 1 ? "s" : ""} consommateur${total > 1 ? "s" : ""}`;

  function buildBaseHref(): string {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    const qs = params.toString();
    return qs ? `/comptes-consommateurs?${qs}` : "/comptes-consommateurs";
  }

  const nextHref = nextCursor
    ? buildCursorUrl(buildBaseHref(), nextCursor)
    : null;

  return (
    <div>
      <AdminPageHeader
        eyebrow="Consommateurs"
        title="Comptes consommateurs"
        subtitle={subtitle}
        error={error}
      />

      <form
        method="get"
        action="/comptes-consommateurs"
        className="mb-4 flex gap-2"
      >
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Rechercher par email"
          className="w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-[13px] text-gray-900 placeholder:text-gray-400 focus:border-terroir-green-700 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          Rechercher
        </button>
        {q ? (
          <Link
            href="/comptes-consommateurs"
            className="rounded-md px-3 py-2 text-[13px] text-gray-500 underline hover:text-gray-700"
          >
            Effacer
          </Link>
        ) : null}
      </form>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-[13px]">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-5 py-3 text-left font-medium text-gray-600">Email</th>
              <th className="px-5 py-3 text-left font-medium text-gray-600">Nom</th>
              <th className="px-5 py-3 text-left font-medium text-gray-600">Type</th>
              <th className="px-5 py-3 text-left font-medium text-gray-600">Inscrit le</th>
              <th className="px-5 py-3 text-left font-medium text-gray-600">Dernière activité</th>
              <th className="px-5 py-3 text-left font-medium text-gray-600">Commandes</th>
              <th className="px-5 py-3 text-right font-medium text-gray-600">{/* actions */}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {rows.length === 0 ? (
              <TableStatus
                kind={q ? "empty-filtered" : "empty"}
                colSpan={7}
                emptyLabel="Aucun compte consommateur"
                emptyFilteredLabel="Aucun compte avec cette recherche"
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
                        : "Jamais connecté"}
                    </td>
                    <td className="px-5 py-3 text-gray-700">{u.ordersCount}</td>
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
            &larr; Retour début
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
          {ADMIN_USERS_PAGE_SIZE} résultats par page
        </p>
      )}
    </div>
  );
}
