"use client";

import { useEffect, useMemo, useState } from "react";
import { AdminPageHeader, FilterTabs, StatusPanel } from "@/components/ui";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { LeadsTable } from "./_components/LeadsTable";
import { DeleteLeadModal } from "./_components/DeleteLeadModal";
import type { Lead, LeadStatus } from "./_components/types";

type Filter = "all" | LeadStatus;

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "Tous" },
  { value: "new", label: "Nouveaux" },
  { value: "contacted", label: "Contactés" },
  { value: "onboarded", label: "Onboardés" },
];

export default function AdminProducerInterestsPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Lead | null>(null);

  const refresh = async () => {
    const supabase = createSupabaseBrowserClient();
    const { data, error: fetchError } = await supabase
      .from("producer_interests")
      .select(
        "id, created_at, prenom, nom, email, telephone, nom_exploitation, commune, especes, message, statut",
      )
      .order("created_at", { ascending: false });
    if (fetchError) {
      setError(fetchError.message);
      setLoading(false);
      return;
    }
    setLeads((data ?? []) as unknown as Lead[]);
    setLoading(false);
  };

  useEffect(() => {
    let active = true;
    (async () => {
      if (!active) return;
      await refresh();
    })();
    return () => {
      active = false;
    };
  }, []);

  const counts = useMemo(
    () => ({
      all: leads.length,
      new: leads.filter((l) => l.statut === "new").length,
      contacted: leads.filter((l) => l.statut === "contacted").length,
      onboarded: leads.filter((l) => l.statut === "onboarded").length,
    }),
    [leads],
  );

  const filtered =
    filter === "all" ? leads : leads.filter((l) => l.statut === filter);

  const setStatus = async (id: string, statut: LeadStatus) => {
    setBusyId(id);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error: upError } = await supabase
      .from("producer_interests")
      .update({ statut })
      .eq("id", id);
    if (upError) {
      setError(upError.message);
    } else {
      setLeads((arr) =>
        arr.map((l) => (l.id === id ? { ...l, statut } : l)),
      );
    }
    setBusyId(null);
  };

  const handleDeleted = () => {
    if (!deleting) return;
    setLeads((arr) => arr.filter((l) => l.id !== deleting.id));
    setDeleting(null);
  };

  return (
    <>
      <div>
        <AdminPageHeader
          eyebrow="Prospection"
          title="Leads producteurs"
          subtitle={`${counts.new} nouveaux · ${counts.contacted} contactés · ${counts.onboarded} onboardés`}
          error={error}
        />

        <FilterTabs
          filters={FILTERS}
          counts={counts}
          active={filter}
          onChange={setFilter}
          className="mb-6 flex flex-wrap gap-1.5 border-b border-gray-200"
        />

        {loading ? (
          <StatusPanel kind="loading" label="Chargement…" />
        ) : (
          <LeadsTable
            leads={filtered}
            busyId={busyId}
            onSetStatus={setStatus}
            onDelete={(lead) => setDeleting(lead)}
          />
        )}
      </div>

      {deleting && (
        <DeleteLeadModal
          lead={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={handleDeleted}
        />
      )}
    </>
  );
}
