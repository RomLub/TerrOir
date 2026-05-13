"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { InvitationStatusFilter } from "@/lib/admin/invitations/types";

// Sub-client de la page admin /invitations — gère uniquement les filtres
// (tabs status + date inputs from/to). Le tableau est rendu par le Server
// Component parent (data fetch SSR via service_role). Les actions revoke
// sont déléguées à `RevokeInvitationTrigger` (un composant client distinct
// par ligne, pour éviter de remonter toute la liste au niveau client).
//
// Pattern : chaque interaction utilisateur (clic tab, submit form date)
// pousse les search params à jour via router.push() ; le Server Component
// re-fetch automatiquement via dynamic = "force-dynamic".

const STATUS_TABS: { value: InvitationStatusFilter; label: string }[] = [
  { value: "all", label: "Toutes" },
  { value: "sent", label: "Envoyées" },
  { value: "consumed", label: "Consommées" },
  { value: "expired", label: "Expirées" },
  { value: "revoked", label: "Révoquées" },
];

type Props = {
  currentStatus: InvitationStatusFilter;
  currentFrom: string;
  currentTo: string;
};

export function InvitationsListClient({
  currentStatus,
  currentFrom,
  currentTo,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [fromInput, setFromInput] = useState(currentFrom);
  const [toInput, setToInput] = useState(currentTo);

  const buildHref = (overrides: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    // Toute mutation des filtres reset le cursor de pagination — sinon on
    // peut se retrouver sur une page interne d'un autre dataset.
    params.delete("before");
    params.delete("before_id");
    for (const [key, value] of Object.entries(overrides)) {
      if (value === null || value === "") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    const qs = params.toString();
    return qs ? `/invitations?${qs}` : "/invitations";
  };

  const onTabClick = (value: InvitationStatusFilter) => {
    router.push(buildHref({ status: value === "all" ? null : value }));
  };

  const onDateSubmit = (e: FormEvent) => {
    e.preventDefault();
    router.push(
      buildHref({
        from: fromInput || null,
        to: toInput || null,
      }),
    );
  };

  const onDateReset = () => {
    setFromInput("");
    setToInput("");
    router.push(buildHref({ from: null, to: null }));
  };

  return (
    <div className="mb-6 space-y-4">
      <div className="flex flex-wrap gap-1.5 border-b border-gray-200">
        {STATUS_TABS.map((tab) => {
          const isActive = currentStatus === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => onTabClick(tab.value)}
              className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-3 text-[14px] font-medium transition-colors ${
                isActive
                  ? "border-terroir-green-700 text-gray-900"
                  : "border-transparent text-gray-600 hover:text-gray-900"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <form
        onSubmit={onDateSubmit}
        className="flex flex-wrap items-end gap-3 rounded-md border border-gray-200 bg-gray-50 px-4 py-3"
      >
        <div>
          <label
            htmlFor="invitations-from"
            className="mb-1 block text-[12px] font-medium text-gray-700"
          >
            Du
          </label>
          <input
            id="invitations-from"
            type="date"
            value={fromInput}
            onChange={(e) => setFromInput(e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-[13px] text-gray-900 focus:border-terroir-green-700 focus:outline-none focus:ring-1 focus:ring-terroir-green-700"
          />
        </div>
        <div>
          <label
            htmlFor="invitations-to"
            className="mb-1 block text-[12px] font-medium text-gray-700"
          >
            Au
          </label>
          <input
            id="invitations-to"
            type="date"
            value={toInput}
            onChange={(e) => setToInput(e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-[13px] text-gray-900 focus:border-terroir-green-700 focus:outline-none focus:ring-1 focus:ring-terroir-green-700"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-terroir-green-700 px-4 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-terroir-green-700/90"
        >
          Filtrer
        </button>
        {(currentFrom || currentTo) && (
          <button
            type="button"
            onClick={onDateReset}
            className="rounded-md px-3 py-1.5 text-[13px] text-gray-700 transition-colors hover:bg-gray-100"
          >
            Effacer dates
          </button>
        )}
      </form>
    </div>
  );
}
