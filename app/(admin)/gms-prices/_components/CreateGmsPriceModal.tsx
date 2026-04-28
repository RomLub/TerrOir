"use client";

import { useState, type FormEvent } from "react";
import { AdminModal, Input, Select, Textarea } from "@/components/ui";

// Modal de création d'une nouvelle référence GMS — Phase B PUSH 4.
// Form complet (slug, filiere, libelle, prix, mois_reference, etc.). HTML5
// natif pour la validation client (required, type=number min=0, pattern) —
// pas de zod côté client, le backend revalide tout via /api/admin/gms-prices.

type Props = {
  onClose: () => void;
  onSuccess: () => void;
};

const FILIERE_OPTIONS = [
  { value: "bovin", label: "Bovin" },
  { value: "porcin", label: "Porcin" },
  { value: "ovin", label: "Ovin" },
];

export function CreateGmsPriceModal({ onClose, onSuccess }: Props) {
  const [slug, setSlug] = useState("");
  const [filiere, setFiliere] = useState("");
  const [libelle, setLibelle] = useState("");
  const [descriptionCourte, setDescriptionCourte] = useState("");
  const [prixGmsKg, setPrixGmsKg] = useState("");
  const [prixTerroirMin, setPrixTerroirMin] = useState("");
  const [prixTerroirMax, setPrixTerroirMax] = useState("");
  const [prixTerroirMoyen, setPrixTerroirMoyen] = useState("");
  const [moisReference, setMoisReference] = useState("");
  const [source, setSource] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [ordreAffichage, setOrdreAffichage] = useState("100");
  const [notesAdmin, setNotesAdmin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const numOrNull = (s: string): number | null => {
      const trimmed = s.trim();
      if (trimmed === "") return null;
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : null;
    };

    const payload = {
      slug: slug.trim(),
      filiere,
      libelle: libelle.trim(),
      description_courte: descriptionCourte.trim() || null,
      prix_gms_kg: Number(prixGmsKg),
      prix_terroir_kg_min: numOrNull(prixTerroirMin),
      prix_terroir_kg_max: numOrNull(prixTerroirMax),
      prix_terroir_kg_moyen: numOrNull(prixTerroirMoyen),
      mois_reference: moisReference.trim(),
      source: source.trim(),
      source_url: sourceUrl.trim() || null,
      ordre_affichage: Number(ordreAffichage),
      notes_admin: notesAdmin.trim() || null,
    };

    try {
      const res = await fetch("/api/admin/gms-prices", {
        method: "POST",
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
      eyebrow="Catalogue"
      title="Nouvelle référence GMS"
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
            form="gms-prices-create-form"
            disabled={submitting}
            className="rounded-md bg-terroir-green-700 px-4 py-2 text-[14px] font-semibold text-white transition-colors hover:bg-terroir-green-700/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Création…" : "Créer la référence"}
          </button>
        </>
      }
    >
      <form
        id="gms-prices-create-form"
        onSubmit={submit}
        className="mt-4 space-y-4"
      >
        <div className="grid grid-cols-2 gap-4">
          <Input
            name="slug"
            label="Slug"
            placeholder="boeuf-rumsteck"
            hint="Kebab-case (a-z, 0-9, -). Figé après création."
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            required
            pattern="[a-z0-9-]+"
            disabled={submitting}
          />
          <Select
            name="filiere"
            label="Filière"
            placeholder="Choisir…"
            options={FILIERE_OPTIONS}
            value={filiere}
            onChange={(e) => setFiliere(e.target.value)}
            required
            disabled={submitting}
            hint="Figée après création."
          />
        </div>
        <Input
          name="libelle"
          label="Libellé"
          placeholder="Rumsteck"
          value={libelle}
          onChange={(e) => setLibelle(e.target.value)}
          required
          disabled={submitting}
        />
        <Textarea
          name="description_courte"
          label="Description courte (optionnel)"
          placeholder="Boucherie GMS, panel Kantar Worldpanel — moyenne nationale"
          rows={2}
          value={descriptionCourte}
          onChange={(e) => setDescriptionCourte(e.target.value)}
          disabled={submitting}
        />

        <div className="grid grid-cols-2 gap-4">
          <Input
            name="prix_gms_kg"
            label="Prix GMS (€/kg)"
            type="number"
            step="0.01"
            min="0.01"
            value={prixGmsKg}
            onChange={(e) => setPrixGmsKg(e.target.value)}
            required
            disabled={submitting}
          />
          <Input
            name="mois_reference"
            label="Mois de référence"
            placeholder="2026-04"
            pattern="\d{4}-\d{2}"
            hint="Format YYYY-MM"
            value={moisReference}
            onChange={(e) => setMoisReference(e.target.value)}
            required
            disabled={submitting}
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Input
            name="prix_terroir_kg_min"
            label="TerrOir min (€/kg)"
            type="number"
            step="0.01"
            min="0.01"
            value={prixTerroirMin}
            onChange={(e) => setPrixTerroirMin(e.target.value)}
            disabled={submitting}
          />
          <Input
            name="prix_terroir_kg_max"
            label="TerrOir max (€/kg)"
            type="number"
            step="0.01"
            min="0.01"
            value={prixTerroirMax}
            onChange={(e) => setPrixTerroirMax(e.target.value)}
            disabled={submitting}
          />
          <Input
            name="prix_terroir_kg_moyen"
            label="TerrOir moyen (€/kg)"
            type="number"
            step="0.01"
            min="0.01"
            value={prixTerroirMoyen}
            onChange={(e) => setPrixTerroirMoyen(e.target.value)}
            disabled={submitting}
          />
        </div>

        <Input
          name="source"
          label="Source"
          placeholder="FranceAgriMer / OFPM (Kantar Worldpanel)"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          required
          disabled={submitting}
        />
        <Input
          name="source_url"
          label="URL source (optionnel)"
          type="url"
          placeholder="https://www.franceagrimer.fr/..."
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
          hint="Tri ASC sur la page publique. Garder de l'espace entre valeurs (ex: 100, 200, 300) pour insérer plus tard."
          value={ordreAffichage}
          onChange={(e) => setOrdreAffichage(e.target.value)}
          required
          disabled={submitting}
        />

        <Textarea
          name="notes_admin"
          label="Notes admin (optionnel, non publiées)"
          placeholder="Sources de calibration, ajustements à valider…"
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
