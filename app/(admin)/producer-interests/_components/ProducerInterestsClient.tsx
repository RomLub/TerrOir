"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminPageHeader, Button, FilterTabs } from "@/components/ui";
import { LeadsTable } from "./LeadsTable";
import { DeleteLeadModal } from "./DeleteLeadModal";
import { NewProspectModal } from "./NewProspectModal";
import type { Lead, LeadSource, LeadStatus } from "./types";

// Client Component du back-office /producer-interests — refactor PR1
// admin-pattern-uniform.
//
// Reçoit `initialLeads` en props depuis le Server Component parent. Toutes
// les mutations passent par les API routes /api/admin/producer-interests/* :
//   - PATCH /[id]/statut : mise à jour du statut d'un lead,
//   - DELETE /[id]       : suppression d'un lead (déléguée à DeleteLeadModal).
//
// L'état local `leads` est synchronisé optimistement après chaque mutation
// réussie, sans router.refresh() — le state initial du SSR reste suffisant
// tant que l'admin reste sur la page (rafraîchissement explicite via
// navigation).

type Filter = "all" | LeadStatus;

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "Tous" },
  { value: "new", label: "Nouveaux" },
  { value: "contacted", label: "Contactés" },
  { value: "onboarded", label: "Onboardés" },
];

export function ProducerInterestsClient({
  initialLeads,
  initialError,
}: {
  initialLeads: Lead[];
  initialError: string | null;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | LeadSource>("all");
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [error, setError] = useState<string | null>(initialError);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Lead | null>(null);
  const [creating, setCreating] = useState(false);

  const counts = useMemo(
    () => ({
      all: leads.length,
      new: leads.filter((l) => l.statut === "new").length,
      contacted: leads.filter((l) => l.statut === "contacted").length,
      onboarded: leads.filter((l) => l.statut === "onboarded").length,
    }),
    [leads],
  );

  const filtered = leads.filter(
    (l) =>
      (filter === "all" || l.statut === filter) &&
      (sourceFilter === "all" || l.source === sourceFilter),
  );

  const SOURCE_TABS: { value: "all" | LeadSource; label: string }[] = [
    { value: "all", label: "Tous" },
    { value: "invitation_directe", label: "Prospectés" },
    { value: "formulaire_public", label: "Spontanés" },
  ];

  const setStatus = async (id: string, statut: LeadStatus) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/producer-interests/${encodeURIComponent(id)}/statut`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ statut }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(body?.error ?? `Erreur HTTP ${res.status}`);
      } else {
        setLeads((arr) =>
          arr.map((l) => (l.id === id ? { ...l, statut } : l)),
        );
      }
    } catch (err) {
      setError((err as Error).message);
    }
    setBusyId(null);
  };

  const handleDeleted = () => {
    if (!deleting) return;
    setLeads((arr) => arr.filter((l) => l.id !== deleting.id));
    setDeleting(null);
    // Refresh côté serveur pour re-fetcher la liste canonique (utile si un
    // autre admin a modifié l'état entre temps). Pas indispensable au
    // bon fonctionnement immédiat, mais bonne hygiène.
    router.refresh();
  };

  return (
    <>
      <div>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <AdminPageHeader
            eyebrow="Prospection"
            title="Leads producteurs"
            subtitle={`${counts.new} nouveaux · ${counts.contacted} contactés · ${counts.onboarded} onboardés`}
            error={error}
          />
          <Button onClick={() => setCreating(true)}>+ Nouveau prospect</Button>
        </div>

        {/* Filtre par parcours (source). */}
        <div className="mb-3 mt-2 flex flex-wrap gap-1.5">
          {SOURCE_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setSourceFilter(t.value)}
              className={`rounded-full px-3 py-1 text-[13px] ${
                sourceFilter === t.value
                  ? "bg-green-700 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <FilterTabs
          filters={FILTERS}
          counts={counts}
          active={filter}
          onChange={setFilter}
          className="mb-6 flex flex-wrap gap-1.5 border-b border-gray-200"
        />

        <LeadsTable
          leads={filtered}
          busyId={busyId}
          onSetStatus={setStatus}
          onDelete={(lead) => setDeleting(lead)}
        />
      </div>

      {deleting && (
        <DeleteLeadModal
          lead={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={handleDeleted}
        />
      )}

      {creating && <NewProspectModal onClose={() => setCreating(false)} />}
    </>
  );
}
