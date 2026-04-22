"use client";

import { useEffect, useMemo, useState } from "react";
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
        "id, created_at, nom, email, telephone, nom_exploitation, commune, especes, message, statut",
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
        <header className="mb-8">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-terroir-green-700">
            Prospection
          </div>
          <h1 className="mt-1 font-serif text-[40px] leading-tight text-gray-900">
            Leads producteurs
          </h1>
          <p className="mt-1 text-[14px] text-gray-500">
            {counts.new} nouveaux · {counts.contacted} contactés ·{" "}
            {counts.onboarded} onboardés
          </p>
          {error && <p className="mt-2 text-[13px] text-red-700">{error}</p>}
        </header>

        <div className="mb-6 flex flex-wrap gap-1.5 border-b border-gray-200">
          {FILTERS.map((f) => {
            const active = filter === f.value;
            return (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-3 text-[14px] font-medium transition-colors ${
                  active
                    ? "border-terroir-green-700 text-gray-900"
                    : "border-transparent text-gray-600 hover:text-gray-900"
                }`}
              >
                {f.label}
                <span
                  className={`rounded px-1.5 font-mono text-[11px] ${
                    active
                      ? "bg-terroir-green-100 text-terroir-green-700"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {counts[f.value]}
                </span>
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
            <div className="px-5 py-12 text-center text-[14px] text-gray-500">
              Chargement…
            </div>
          </div>
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
