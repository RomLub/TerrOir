"use client";

import { useState, type FormEvent } from "react";
import { AdminModal, Input } from "@/components/ui";
import type { GmsPriceRow } from "../page";

// Modal workflow mensuel — Phase B PUSH 4.
// Form : prix_gms_kg, prix_terroir_kg_min/max/moyen, mois_reference, source,
// source_url. Affiche les prix actuels en read-only au-dessus pour aider la
// comparaison (cf. brief PUSH 4).
//
// Backend (lib/gms-prices/admin-write.ts) : UPDATE live + INSERT history,
// atomicité applicative (cf. arbitrage A1). Si history fail mais live OK,
// la route renvoie history_recorded=false → on l'affiche en warning amber.

type Props = {
  row: GmsPriceRow;
  onClose: () => void;
  onSuccess: () => void;
};

// Suggère le mois suivant le mois_reference actuel pour faciliter la saisie
// d'un cycle mensuel régulier. Si parsing fail, fallback chaîne vide.
function suggestNextMonth(current: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(current);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return "";
  const nextDate = new Date(Date.UTC(year, month, 1)); // month is 1-12 → Date 0-11, donc +1 = next month
  const nextYear = nextDate.getUTCFullYear();
  const nextMonth = String(nextDate.getUTCMonth() + 1).padStart(2, "0");
  return `${nextYear}-${nextMonth}`;
}

export function MonthlyUpdateModal({ row, onClose, onSuccess }: Props) {
  const [prixGmsKg, setPrixGmsKg] = useState(String(row.prix_gms_kg));
  const [prixTerroirMin, setPrixTerroirMin] = useState(
    row.prix_terroir_kg_min !== null ? String(row.prix_terroir_kg_min) : "",
  );
  const [prixTerroirMax, setPrixTerroirMax] = useState(
    row.prix_terroir_kg_max !== null ? String(row.prix_terroir_kg_max) : "",
  );
  const [prixTerroirMoyen, setPrixTerroirMoyen] = useState(
    row.prix_terroir_kg_moyen !== null ? String(row.prix_terroir_kg_moyen) : "",
  );
  const [moisReference, setMoisReference] = useState(
    suggestNextMonth(row.mois_reference),
  );
  const [source, setSource] = useState(row.source);
  const [sourceUrl, setSourceUrl] = useState(row.source_url ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyWarning, setHistoryWarning] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setHistoryWarning(false);

    const numOrNull = (s: string): number | null => {
      const trimmed = s.trim();
      if (trimmed === "") return null;
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : null;
    };

    const payload = {
      prix_gms_kg: Number(prixGmsKg),
      prix_terroir_kg_min: numOrNull(prixTerroirMin),
      prix_terroir_kg_max: numOrNull(prixTerroirMax),
      prix_terroir_kg_moyen: numOrNull(prixTerroirMoyen),
      mois_reference: moisReference.trim(),
      source: source.trim(),
      source_url: sourceUrl.trim() || null,
    };

    try {
      const res = await fetch(
        `/api/admin/gms-prices/${row.id}/update-prices`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const body = await res.json().catch(() => ({ error: "Erreur réseau" }));
      if (!res.ok) {
        setError(body.error ?? `Erreur ${res.status}`);
        return;
      }
      // Live OK ; vérifier le flag history_recorded propagé par la route.
      if (body.history_recorded === false) {
        setHistoryWarning(true);
        // Ne ferme pas le modal — Romain doit voir le warning explicitement.
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
      eyebrow="Workflow"
      title={`Mise à jour mensuelle — ${row.libelle}`}
      size="lg"
      footer={
        <>
          <button
            type="button"
            onClick={historyWarning ? onSuccess : onClose}
            disabled={submitting}
            className="rounded-md px-4 py-2 text-[14px] text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-60"
          >
            {historyWarning ? "Fermer (prix mis à jour)" : "Annuler"}
          </button>
          {!historyWarning && (
            <button
              type="submit"
              form="gms-prices-monthly-form"
              disabled={submitting}
              className="rounded-md bg-terroir-green-700 px-4 py-2 text-[14px] font-semibold text-white transition-colors hover:bg-terroir-green-700/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Mise à jour…" : "Mettre à jour les prix"}
            </button>
          )}
        </>
      }
    >
      <div className="mt-4 rounded-md bg-gray-50 px-4 py-3">
        <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">
          Valeurs actuelles
        </p>
        <div className="mt-2 grid grid-cols-3 gap-3 text-[13px]">
          <ActualField label="Prix GMS" value={`${row.prix_gms_kg.toFixed(2)} €/kg`} />
          <ActualField
            label="TerrOir moyen"
            value={
              row.prix_terroir_kg_moyen !== null
                ? `${row.prix_terroir_kg_moyen.toFixed(2)} €/kg`
                : "—"
            }
          />
          <ActualField label="Mois ref." value={row.mois_reference} />
        </div>
      </div>

      <p className="mt-4 text-[13px] leading-relaxed text-gray-700">
        Cette opération met à jour les prix affichés publiquement et archive
        les nouvelles valeurs dans <code className="font-mono text-[12px]">gms_prices_history</code>{" "}
        pour la traçabilité mensuelle.
      </p>

      <form
        id="gms-prices-monthly-form"
        onSubmit={submit}
        className="mt-4 space-y-4"
      >
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
            disabled={submitting || historyWarning}
          />
          <Input
            name="mois_reference"
            label="Mois de référence"
            placeholder="2026-05"
            pattern="\d{4}-\d{2}"
            hint="Format YYYY-MM (UNIQUE par référence dans l'history)"
            value={moisReference}
            onChange={(e) => setMoisReference(e.target.value)}
            required
            disabled={submitting || historyWarning}
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
            disabled={submitting || historyWarning}
          />
          <Input
            name="prix_terroir_kg_max"
            label="TerrOir max (€/kg)"
            type="number"
            step="0.01"
            min="0.01"
            value={prixTerroirMax}
            onChange={(e) => setPrixTerroirMax(e.target.value)}
            disabled={submitting || historyWarning}
          />
          <Input
            name="prix_terroir_kg_moyen"
            label="TerrOir moyen (€/kg)"
            type="number"
            step="0.01"
            min="0.01"
            value={prixTerroirMoyen}
            onChange={(e) => setPrixTerroirMoyen(e.target.value)}
            disabled={submitting || historyWarning}
          />
        </div>

        <Input
          name="source"
          label="Source"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          required
          disabled={submitting || historyWarning}
        />
        <Input
          name="source_url"
          label="URL source (optionnel)"
          type="url"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          disabled={submitting || historyWarning}
        />

        {historyWarning && (
          <div
            className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-900"
            role="alert"
          >
            <p className="font-semibold">
              Prix mis à jour, mais snapshot history non enregistré
            </p>
            <p className="mt-1 leading-relaxed">
              Le prix public est correct, mais l&apos;insertion dans
              <code className="mx-1 font-mono text-[12px]">gms_prices_history</code>
              a échoué (probablement contrainte UNIQUE sur le mois ).
              Vérifier que le mois choisi (<strong>{moisReference}</strong>) n&apos;est
              pas déjà historisé pour cette référence. Retry possible
              manuellement via Supabase Studio si besoin.
            </p>
          </div>
        )}

        {error && (
          <p className="text-[13px] text-red-700" role="alert">
            {error}
          </p>
        )}
      </form>
    </AdminModal>
  );
}

function ActualField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[13px] text-gray-900">{value}</div>
    </div>
  );
}
