import { formatDateFr } from "@/lib/format/date";
import type { UserComplianceRow } from "@/lib/legal/compliance";
import { ComplianceStatusBadge } from "./StatusBadge";

type Props = {
  rows: UserComplianceRow[];
};

export function ComplianceUsersTable({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-gray-200 bg-white p-6 text-center text-[14px] text-gray-600">
        Aucun utilisateur ne correspond aux filtres.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-[14px]">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-100 text-left text-[11px] uppercase tracking-[0.14em] text-gray-600">
              <th className="px-5 py-3 font-semibold">Email</th>
              <th className="px-5 py-3 font-semibold">Inscription</th>
              <th className="px-5 py-3 font-semibold">Statut CGU</th>
              <th className="px-5 py-3 font-semibold">Acceptée le</th>
              <th className="px-5 py-3 font-semibold">Version</th>
              <th className="px-5 py-3 text-right font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr
                key={u.id}
                className="border-b border-gray-200 last:border-0 hover:bg-gray-50"
              >
                <td className="px-5 py-4 text-gray-900">
                  <div className="font-medium">{u.email}</div>
                  {(u.prenom || u.nom) && (
                    <div className="text-[12px] text-gray-500">
                      {[u.prenom, u.nom].filter(Boolean).join(" ")}
                    </div>
                  )}
                </td>
                <td className="px-5 py-4 text-gray-700">
                  {formatDateFr(u.createdAt)}
                </td>
                <td className="px-5 py-4">
                  <ComplianceStatusBadge status={u.status} />
                </td>
                <td className="px-5 py-4 text-gray-700">
                  {u.acceptedAt ? formatDateFr(u.acceptedAt) : "—"}
                </td>
                <td className="px-5 py-4 font-mono text-[12px] text-gray-700">
                  {u.acceptedVersion ?? "—"}
                </td>
                <td className="px-5 py-4 text-right">
                  {/* Placeholder V2 : bouton "Forcer réacceptation" sera
                      câblé au chantier 3 (popup réacceptation CGU). En V1
                      on rend le bouton désactivé pour signaler le futur
                      flow sans laisser de surface cliquable trompeuse. */}
                  <button
                    type="button"
                    disabled
                    title="Disponible avec le chantier popup réacceptation"
                    className="cursor-not-allowed rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-[12px] text-gray-400"
                  >
                    Forcer réacceptation
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
