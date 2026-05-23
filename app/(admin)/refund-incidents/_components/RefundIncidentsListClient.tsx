"use client";

import { useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AdminPageHeader,
  FilterTabs,
  TableActionButton,
  TableStatus,
} from "@/components/ui";
import {
  REFUND_INCIDENT_STATUS_FILTERS,
  getRefundIncidentStatusLabel,
  type AdminRefundIncidentRow,
  type RefundIncidentStatusFilter,
} from "@/lib/admin/refund-incidents/types";
import { formatDateFr } from "@/lib/format/date";

// Client Component liste /refund-incidents (PR3 feature/admin-new-
// surfaces). Reçoit les rows fetchées côté Server Component via
// service_role (cf. page.tsx parent). Responsabilités :
//   - Filtres tabs status (pending / retrying / failed / resolved /
//     resolved_manually / all) — via search param `status`
//   - Pagination cursor (lien "Page suivante" Server-rendered)
//   - Lien vers la page détail [id]
//
// Pas de mutation ici : la résolution manuelle se fait depuis la page
// détail via le modal ResolveIncidentModal (cohérent pattern UX = action
// sur un seul incident à la fois, contexte complet visible).

const FILTER_LABELS: Record<RefundIncidentStatusFilter, string> = {
  pending: "En attente",
  retrying: "Retry en cours",
  failed: "Échec",
  resolved: "Résolus (auto)",
  resolved_manually: "Résolus (admin)",
  all: "Tous",
};

type Props = {
  initialRows: AdminRefundIncidentRow[];
  initialTotal: number;
  initialNextCursor: { created_at: string; id: string } | null;
  initialError: string | null;
  initialStatusFilter: RefundIncidentStatusFilter;
  isPaginated: boolean;
};

function formatAmount(cents: number): string {
  return `${(cents / 100).toFixed(2)} €`;
}

export function RefundIncidentsListClient({
  initialRows,
  initialTotal,
  initialNextCursor,
  initialError,
  initialStatusFilter,
  isPaginated,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const filterOptions = useMemo(
    () =>
      REFUND_INCIDENT_STATUS_FILTERS.map((value) => ({
        value,
        label: FILTER_LABELS[value],
      })),
    [],
  );

  // Counts par filtre = total reçu en prop pour le filtre actif, 0 pour
  // les autres (le Server Component refetch déjà avec le bon filtre SQL,
  // on n'a pas les counts distincts par status sans 6 queries). Cohérent
  // pattern audit-logs (où les counts par status sont aussi côté actif).
  const counts = useMemo(
    () =>
      Object.fromEntries(
        REFUND_INCIDENT_STATUS_FILTERS.map((v) => [
          v,
          v === initialStatusFilter ? initialTotal : 0,
        ]),
      ) as Record<RefundIncidentStatusFilter, number>,
    [initialStatusFilter, initialTotal],
  );

  const handleFilterChange = (next: RefundIncidentStatusFilter) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (next === "pending") {
      params.delete("status");
    } else {
      params.set("status", next);
    }
    // Reset cursor quand on change le filtre : la page 2+ devient
    // invalide dès que le filtre SQL change.
    params.delete("before");
    params.delete("before_id");
    startTransition(() => {
      router.push(
        `/refund-incidents${params.toString() ? `?${params.toString()}` : ""}`,
      );
    });
  };

  const buildPaginationUrl = (): string | null => {
    if (!initialNextCursor) return null;
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("before", initialNextCursor.created_at);
    params.set("before_id", initialNextCursor.id);
    return `/refund-incidents?${params.toString()}`;
  };

  const nextHref = buildPaginationUrl();

  return (
    <div className="px-6 pb-6 pt-4">
      <AdminPageHeader
        title="Incidents techniques"
        subtitle={`${initialTotal} incident${initialTotal > 1 ? "s" : ""} (${getStatusFilterDescription(initialStatusFilter)})`}
        error={initialError}
      />

      <div className="mb-4">
        <FilterTabs
          filters={filterOptions}
          counts={counts}
          active={initialStatusFilter}
          onChange={handleFilterChange}
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-600">
            <tr>
              <th className="px-4 py-3">Code commande</th>
              <th className="px-4 py-3">Montant</th>
              <th className="px-4 py-3">Statut</th>
              <th className="px-4 py-3">Tentatives</th>
              <th className="px-4 py-3">Dernière erreur</th>
              <th className="px-4 py-3">Créé le</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {initialRows.length === 0 ? (
              <TableStatus
                kind="empty"
                colSpan={7}
                emptyLabel="Aucun incident"
              />
            ) : (
              initialRows.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">
                    {row.orderCode ?? row.orderId.slice(0, 8)}
                  </td>
                  <td className="px-4 py-3 text-gray-900">
                    {formatAmount(row.amountCents)}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {getRefundIncidentStatusLabel(row.status)}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {row.retryCount} / {row.maxRetries}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {row.lastErrorCode ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {formatDateFr(row.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <TableActionButton
                      href={`/refund-incidents/${row.id}`}
                      variant="primary"
                    >
                      Détails
                    </TableActionButton>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {(isPaginated || nextHref) && (
        <div className="mt-4 flex items-center justify-between text-sm text-gray-700">
          <span>
            {initialRows.length} incident{initialRows.length > 1 ? "s" : ""} affiché
            {initialRows.length > 1 ? "s" : ""} sur {initialTotal} total
          </span>
          {nextHref ? (
            <Link
              href={nextHref}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              Page suivante
            </Link>
          ) : null}
        </div>
      )}
    </div>
  );
}

function getStatusFilterDescription(
  filter: RefundIncidentStatusFilter,
): string {
  return FILTER_LABELS[filter] ?? filter;
}
