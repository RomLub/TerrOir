import Link from "next/link";
import { AdminPageHeader } from "@/components/ui/admin-page-header";
import { Badge } from "@/components/ui/badge";
import { TableStatus } from "@/components/ui/table-status";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatDateFr } from "@/lib/format/date";
import { fetchAdminDisputesList } from "@/lib/admin/disputes/fetch";
import {
  DISPUTE_STATUS_LABEL,
  type DisputeStatus,
} from "@/lib/admin/disputes/types";

// Chantier 8 — page admin Litiges (section Gouvernance). Liste des disputes
// Stripe (table alimentée par le webhook charge.dispute.*). Lecture + accès
// au détail pour soumettre des preuves.
//
// Auth gardée par app/(admin)/layout.tsx (redirect /connexion si !isAdmin).
export const dynamic = "force-dynamic";
export const revalidate = 0;

const STATUS_VARIANT: Record<DisputeStatus, "green" | "terra" | "danger" | "gray"> = {
  needs_response: "terra",
  warning_needs_response: "terra",
  under_review: "gray",
  warning_under_review: "gray",
  won: "green",
  lost: "danger",
  warning_closed: "gray",
};

export default async function AdminLitigesPage() {
  const admin = createSupabaseAdminClient();
  const { rows, error } = await fetchAdminDisputesList(admin);
  const openCount = rows.filter((r) => r.closedAt == null).length;

  return (
    <div>
      <AdminPageHeader
        eyebrow="Gouvernance"
        title="Litiges"
        subtitle={error ? undefined : `${openCount} litige${openCount > 1 ? "s" : ""} ouvert${openCount > 1 ? "s" : ""} sur ${rows.length}`}
        error={error}
      />

      <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-100 text-left text-[11px] uppercase tracking-[0.14em] text-gray-600">
                <th className="px-5 py-3 font-semibold">Commande</th>
                <th className="px-5 py-3 font-semibold">Statut</th>
                <th className="px-5 py-3 font-semibold">Motif</th>
                <th className="px-5 py-3 font-semibold">Montant</th>
                <th className="px-5 py-3 font-semibold">Échéance preuves</th>
                <th className="px-5 py-3 font-semibold">Ouvert le</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <TableStatus kind="empty" colSpan={6} emptyLabel="Aucun litige." />
              ) : (
                rows.map((d) => (
                  <tr
                    key={d.id}
                    className="border-b border-gray-200 last:border-0 hover:bg-gray-50"
                  >
                    <td className="px-5 py-4">
                      <Link
                        href={`/litiges/${d.id}`}
                        className="font-medium text-terroir-green-700 hover:underline"
                      >
                        {d.orderCode ?? "—"}
                      </Link>
                    </td>
                    <td className="px-5 py-4">
                      <Badge variant={STATUS_VARIANT[d.status]}>
                        {DISPUTE_STATUS_LABEL[d.status]}
                      </Badge>
                    </td>
                    <td className="px-5 py-4 text-gray-700">{d.reason ?? "—"}</td>
                    <td className="px-5 py-4 text-gray-700">
                      {d.amount.toFixed(2)} {d.currency.toUpperCase()}
                    </td>
                    <td className="px-5 py-4 text-gray-500">
                      {d.evidenceDueBy ? formatDateFr(d.evidenceDueBy) : "—"}
                    </td>
                    <td className="px-5 py-4 font-mono text-[13px] text-gray-500">
                      {formatDateFr(d.createdAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
