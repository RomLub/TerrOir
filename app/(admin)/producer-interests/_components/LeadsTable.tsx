"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateFr } from "@/lib/format/date";
import { LeadStatusBadge } from "./LeadStatusBadge";
import type { Lead, LeadStatus } from "./types";

export function LeadsTable({
  leads,
  busyId,
  onSetStatus,
  onDelete,
}: {
  leads: Lead[];
  busyId: string | null;
  onSetStatus: (id: string, statut: LeadStatus) => void | Promise<void>;
  onDelete: (lead: Lead) => void;
}) {
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const invite = (lead: Lead) => {
    // Redirige vers /gestion-producteurs avec pré-remplissage email. La page
    // gestion-producteurs lit ?invite=<email> au mount et ouvre son
    // InviteModal avec la valeur. L'admin clique manuellement "Marquer
    // contacté" ensuite (pas d'auto-update pour rester explicite).
    const params = new URLSearchParams({ invite: lead.email });
    router.push(`/gestion-producteurs?${params.toString()}`);
  };

  if (leads.length === 0) {
    return (
      <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
        <div className="px-5 py-12 text-center text-[14px] text-gray-500">
          Aucun lead dans cette catégorie.
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-[14px]">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-100 text-left text-[11px] uppercase tracking-[0.14em] text-gray-600">
              <th className="px-5 py-3 font-semibold">Reçu le</th>
              <th className="px-5 py-3 font-semibold">Contact</th>
              <th className="px-5 py-3 font-semibold">Exploitation</th>
              <th className="px-5 py-3 font-semibold">Statut</th>
              <th className="px-5 py-3 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => {
              const disabled = busyId === lead.id;
              const expanded = expandedId === lead.id;
              const city = lead.commune ?? "—";
              const exploitation = lead.nom_exploitation ?? "—";
              return (
                <Fragment key={lead.id}>
                  <tr
                    className="cursor-pointer border-b border-gray-200 last:border-0 hover:bg-gray-50"
                    onClick={() =>
                      setExpandedId((id) => (id === lead.id ? null : lead.id))
                    }
                  >
                    <td className="px-5 py-4 font-mono text-[13px] text-gray-500">
                      {formatDateFr(lead.created_at)}
                    </td>
                    <td className="px-5 py-4">
                      <div className="font-serif text-[17px] leading-tight text-gray-900">
                        {lead.nom}
                      </div>
                      <div className="mt-0.5 text-[12px] text-gray-500">
                        {lead.email}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="text-gray-900">{exploitation}</div>
                      <div className="mt-0.5 text-[12px] text-gray-500">
                        {city}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <LeadStatusBadge status={lead.statut} />
                    </td>
                    <td
                      className="px-5 py-4"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {lead.statut === "new" && (
                          <>
                            <button
                              type="button"
                              onClick={() => onSetStatus(lead.id, "contacted")}
                              disabled={disabled}
                              className="rounded-md px-3 py-1.5 text-[12px] font-medium text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-60"
                            >
                              Marquer contacté
                            </button>
                            <button
                              type="button"
                              onClick={() => invite(lead)}
                              disabled={disabled}
                              className="rounded-md bg-terroir-green-700 px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-terroir-green-700/90 disabled:opacity-60"
                            >
                              Inviter
                            </button>
                          </>
                        )}
                        {lead.statut === "contacted" && (
                          <>
                            <button
                              type="button"
                              onClick={() => onSetStatus(lead.id, "onboarded")}
                              disabled={disabled}
                              className="rounded-md bg-terroir-green-700 px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-terroir-green-700/90 disabled:opacity-60"
                            >
                              Marquer onboardé
                            </button>
                            <button
                              type="button"
                              onClick={() => onSetStatus(lead.id, "new")}
                              disabled={disabled}
                              className="rounded-md px-3 py-1.5 text-[12px] font-medium text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-60"
                            >
                              Réouvrir
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => onDelete(lead)}
                          disabled={disabled}
                          className="rounded-md px-3 py-1.5 text-[12px] font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-60"
                        >
                          Supprimer
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="border-b border-gray-200 bg-gray-50 last:border-0">
                      <td colSpan={5} className="px-5 py-4">
                        <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-[13px] md:grid-cols-3">
                          <div>
                            <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                              Téléphone
                            </dt>
                            <dd className="mt-1 text-gray-900">
                              {lead.telephone ?? "—"}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                              Espèces
                            </dt>
                            <dd className="mt-1 text-gray-900">
                              {lead.especes && lead.especes.length > 0
                                ? lead.especes.join(", ")
                                : "—"}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                              Email
                            </dt>
                            <dd className="mt-1">
                              <a
                                href={`mailto:${lead.email}`}
                                className="text-terroir-green-700 underline hover:text-terroir-green-700/80"
                              >
                                {lead.email}
                              </a>
                            </dd>
                          </div>
                          <div className="md:col-span-3">
                            <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                              Message
                            </dt>
                            <dd className="mt-1 whitespace-pre-wrap text-gray-900">
                              {lead.message ?? (
                                <span className="italic text-gray-500">
                                  (aucun message)
                                </span>
                              )}
                            </dd>
                          </div>
                        </dl>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
