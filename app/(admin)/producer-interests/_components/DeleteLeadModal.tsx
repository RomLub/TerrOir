"use client";

import { useState } from "react";
import { AdminModal } from "@/components/ui";
import type { Lead } from "./types";

// Modal de confirmation suppression d'un lead producteur.
//
// Refactor PR1 admin-pattern-uniform : la suppression passe désormais par
// l'API route /api/admin/producer-interests/[id] (DELETE) plutôt que par un
// .delete() direct browser client. Avantages :
//   - audit log obligatoire côté serveur (snapshot complet du lead),
//   - cohérence avec le pattern WRITE admin du reste du back-office,
//   - défense in depth (auth check sur la route en plus de la RLS).

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
    try {
      const res = await fetch(
        `/api/admin/producer-interests/${encodeURIComponent(lead.id)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(body?.error ?? `Erreur HTTP ${res.status}`);
        setBusy(false);
        return;
      }
      onDeleted();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <AdminModal
      open
      onClose={onClose}
      eyebrow="Suppression"
      title="Supprimer ce lead ?"
      size="md"
      footer={
        <>
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
        </>
      }
    >
      <p className="mt-3 text-[14px] leading-relaxed text-gray-700">
        Le lead de{" "}
        <span className="font-semibold text-gray-900">{lead.nom}</span> (
        {lead.email}) sera supprimé définitivement. Cette action est
        irréversible.
      </p>
      {error && <p className="mt-3 text-[13px] text-red-700">{error}</p>}
    </AdminModal>
  );
}
