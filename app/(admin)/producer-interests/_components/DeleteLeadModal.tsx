"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Lead } from "./types";

export function DeleteLeadModal({
  lead,
  onClose,
  onDeleted,
}: {
  lead: Lead;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error: delError } = await supabase
      .from("producer_interests")
      .delete()
      .eq("id", lead.id);
    if (delError) {
      setError(delError.message);
      setBusy(false);
      return;
    }
    onDeleted();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-md border border-gray-200 bg-white p-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-red-700">
          Suppression
        </div>
        <h2 className="mt-1 font-serif text-[24px] leading-tight text-gray-900">
          Supprimer ce lead&nbsp;?
        </h2>
        <p className="mt-3 text-[14px] leading-relaxed text-gray-700">
          Le lead de{" "}
          <span className="font-semibold text-gray-900">{lead.nom}</span> (
          {lead.email}) sera supprimé définitivement. Cette action est
          irréversible.
        </p>
        {error && <p className="mt-3 text-[13px] text-red-700">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md px-4 py-2 text-[14px] text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-60"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={busy}
            className="rounded-md bg-red-700 px-4 py-2 text-[14px] font-semibold text-white transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Suppression…" : "Supprimer"}
          </button>
        </div>
      </div>
    </div>
  );
}
