"use client";

import { useState, type FormEvent } from "react";
import { AdminModal, Input, Textarea } from "@/components/ui";
import type { GmsPriceRow } from "../page";

// Modal d'édition standard (hors workflow mensuel) — Phase B PUSH 4.
// Champs éditables : libelle, description_courte, source, source_url,
// ordre_affichage, notes_admin (cf. arbitrage A3).
//
// Slug + filiere + prix_* + mois_reference + active sont rendus en lecture
// seule (read-only via styling) avec un message rappelant les workflows
// alternatifs ("Mise à jour mensuelle" pour les prix, "Archiver" pour active).

type Props = {
  row: GmsPriceRow;
  onClose: () => void;
  onSuccess: () => void;
};

export function EditGmsPriceModal({ row, onClose, onSuccess }: Props) {
  const [libelle, setLibelle] = useState(row.libelle);
  const [descriptionCourte, setDescriptionCourte] = useState(
    row.description_courte ?? "",
  );
  const [source, setSource] = useState(row.source);
  const [sourceUrl, setSourceUrl] = useState(row.source_url ?? "");
  const [ordreAffichage, setOrdreAffichage] = useState(
    String(row.ordre_affichage),
  );
  const [notesAdmin, setNotesAdmin] = useState(row.notes_admin ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const payload = {
      libelle: libelle.trim(),
      description_courte: descriptionCourte.trim() || null,
      source: source.trim(),
      source_url: sourceUrl.trim() || null,
      ordre_affichage: Number(ordreAffichage),
      notes_admin: notesAdmin.trim() || null,
    };

    try {
      const res = await fetch(`/api/admin/gms-prices/${row.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Erreur réseau" }));
        setError(body.error ?? `Erreur ${res.status}`);
        return;
      }
      onSuccess();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AdminModal
      open
      onClose={onClose}
      eyebrow="Édition"
      title={`Modifier "${row.libelle}"`}
      size="lg"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md px-4 py-2 text-[14px] text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-60"
          >
            Annuler
          </button>
          <button
            type="submit"
            form="gms-prices-edit-form"
            disabled={submitting}
            className="rounded-md bg-terroir-green-700 px-4 py-2 text-[14px] font-semibold text-white transition-colors hover:bg-terroir-green-700/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Enregistrement…" : "Enregistrer"}
          </button>
        </>
      }
    >
      <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
        <p className="font-semibold">Champs verrouillés</p>
        <p className="mt-1 leading-relaxed">
          Pour modifier les prix, utiliser <strong>Mise à jour mensuelle</strong>.
          Pour archiver, utiliser le bouton dédié sur la liste.
          Slug et filière ne sont pas modifiables (URLs publiques figées).
        </p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 rounded-md bg-gray-50 px-4 py-3">
        <ReadOnlyField label="Slug" value={row.slug} mono />
        <ReadOnlyField label="Filière" value={row.filiere} />
        <ReadOnlyField
          label="Prix GMS"
          value={`${row.prix_gms_kg.toFixed(2)} €/kg`}
          mono
        />
        <ReadOnlyField
          label="Mois ref."
          value={row.mois_reference}
          mono
        />
      </div>

      <form
        id="gms-prices-edit-form"
        onSubmit={submit}
        className="mt-6 space-y-4"
      >
        <Input
          name="libelle"
          label="Libellé"
          value={libelle}
          onChange={(e) => setLibelle(e.target.value)}
          required
          disabled={submitting}
        />
        <Textarea
          name="description_courte"
          label="Description courte (optionnel)"
          rows={2}
          value={descriptionCourte}
          onChange={(e) => setDescriptionCourte(e.target.value)}
          disabled={submitting}
        />
        <Input
          name="source"
          label="Source"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          required
          disabled={submitting}
        />
        <Input
          name="source_url"
          label="URL source (optionnel)"
          type="url"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          disabled={submitting}
        />
        <Input
          name="ordre_affichage"
          label="Ordre d'affichage"
          type="number"
          step="1"
          min="0"
          value={ordreAffichage}
          onChange={(e) => setOrdreAffichage(e.target.value)}
          required
          disabled={submitting}
        />
        <Textarea
          name="notes_admin"
          label="Notes admin (optionnel, non publiées)"
          rows={3}
          value={notesAdmin}
          onChange={(e) => setNotesAdmin(e.target.value)}
          disabled={submitting}
        />

        {error && (
          <p className="text-[13px] text-red-700" role="alert">
            {error}
          </p>
        )}
      </form>
    </AdminModal>
  );
}

function ReadOnlyField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wider text-gray-500">
        {label}
      </div>
      <div
        className={`mt-0.5 text-[14px] text-gray-900 ${mono ? "font-mono" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}
