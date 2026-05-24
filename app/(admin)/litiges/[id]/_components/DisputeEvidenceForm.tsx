"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { formatDateFr } from "@/lib/format/date";
import type { DisputeEvidenceFields } from "@/lib/admin/disputes/types";

// Chantier 8 — formulaire de preuves d'un litige. « Enregistrer » = brouillon
// (modifiable). « Soumettre définitivement » = envoi final à Stripe (le litige
// passe en examen, plus aucune modification possible) → confirmation requise.

type Props = {
  disputeId: string;
  initialEvidence: DisputeEvidenceFields;
  dueBy: string | null;
  submissionCount: number;
};

const FIELDS: {
  key: keyof DisputeEvidenceFields;
  label: string;
  multiline?: boolean;
  hint?: string;
}[] = [
  { key: "product_description", label: "Description du produit / de la commande", multiline: true },
  { key: "customer_name", label: "Nom du client" },
  { key: "customer_email_address", label: "Email du client" },
  { key: "service_date", label: "Date de retrait / service (ex : 2026-05-20)" },
  {
    key: "uncategorized_text",
    label: "Preuves complémentaires (texte libre)",
    multiline: true,
    hint: "Collez ici tout élément utile : validation du retrait (code producteur), échanges avec le client, détails de la commande.",
  },
];

export function DisputeEvidenceForm({
  disputeId,
  initialEvidence,
  dueBy,
  submissionCount,
}: Props) {
  const router = useRouter();
  const [values, setValues] = useState<DisputeEvidenceFields>(initialEvidence);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "submit" | null>(null);
  const [, startTransition] = useTransition();

  async function send(submit: boolean) {
    if (submit) {
      const confirmed = window.confirm(
        "Soumettre définitivement les preuves à Stripe ? Cette action est IRRÉVERSIBLE : le litige passera en examen et ne pourra plus être modifié.",
      );
      if (!confirmed) return;
    }
    setBusy(submit ? "submit" : "save");
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(`/api/admin/disputes/${disputeId}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evidence: values, submit }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? `Erreur HTTP ${res.status}`);
        return;
      }
      setOkMsg(submit ? "Preuves soumises à Stripe." : "Brouillon enregistré.");
      startTransition(() => router.refresh());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-md border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="font-serif text-[18px] text-gray-900">Preuves de défense</h2>
      <p className="mt-1 text-[13px] text-gray-600">
        {dueBy ? (
          <>Échéance Stripe : <strong>{formatDateFr(dueBy)}</strong>. </>
        ) : null}
        {submissionCount > 0
          ? `Déjà ${submissionCount} soumission(s).`
          : "Aucune preuve encore soumise."}
      </p>

      {error ? (
        <div className="mt-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {okMsg ? (
        <div className="mt-3 rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-700">
          {okMsg}
        </div>
      ) : null}

      <div className="mt-4 space-y-4">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label className="block text-[13px] font-medium text-gray-700">
              {f.label}
            </label>
            {f.hint ? (
              <p className="mb-1 text-[12px] text-gray-400">{f.hint}</p>
            ) : null}
            {f.multiline ? (
              <textarea
                value={values[f.key]}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                rows={4}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-[13px] text-gray-900 focus:border-terroir-green-700 focus:outline-none"
              />
            ) : (
              <input
                type="text"
                value={values[f.key]}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-[13px] text-gray-900 focus:border-terroir-green-700 focus:outline-none"
              />
            )}
          </div>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => send(false)} disabled={busy !== null}>
          Enregistrer le brouillon
        </Button>
        <Button onClick={() => send(true)} disabled={busy !== null}>
          Soumettre définitivement
        </Button>
        <span className="text-[12px] text-gray-400">
          La soumission définitive est irréversible.
        </span>
      </div>
    </div>
  );
}
