"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AdminPageHeader,
  Button,
  FilterTabs,
  StatusDotBadge,
  TableActionButton,
  TableStatus,
} from "@/components/ui";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { GmsPriceFiliere } from "@/lib/gms-prices/fetch-active";
import { CreateGmsPriceModal } from "./_components/CreateGmsPriceModal";
import { EditGmsPriceModal } from "./_components/EditGmsPriceModal";
import { MonthlyUpdateModal } from "./_components/MonthlyUpdateModal";

// Page d'admin /admin/gms-prices — Phase B (chantier "Notre démarche").
// Pattern aligné app/(admin)/gestion-producteurs/page.tsx :
//   - 'use client' complet
//   - READ direct via createSupabaseBrowserClient (RLS public_read sur active=true,
//     defense-in-depth applicative côté filter)
//   - WRITE via fetch /api/admin/gms-prices/* (jamais service_role côté client)
//   - error/state inline (pas de toast lib dans le repo, cf. PUSH 4 inspection)

export type GmsPriceRow = {
  id: string;
  slug: string;
  filiere: GmsPriceFiliere;
  libelle: string;
  description_courte: string | null;
  prix_gms_kg: number;
  prix_terroir_kg_min: number | null;
  prix_terroir_kg_max: number | null;
  prix_terroir_kg_moyen: number | null;
  mois_reference: string;
  source: string;
  source_url: string | null;
  ordre_affichage: number;
  notes_admin: string | null;
  active: boolean;
};

type Filter = "all" | GmsPriceFiliere;
const BASE_FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "Toutes" },
  { value: "bovin", label: "Bovin" },
  { value: "porcin", label: "Porcin" },
  { value: "ovin", label: "Ovin" },
];

const FILIERE_LABEL: Record<GmsPriceFiliere, string> = {
  bovin: "Bovin",
  porcin: "Porcin",
  ovin: "Ovin",
};

function matchesFilter(filiere: GmsPriceFiliere, filter: Filter): boolean {
  if (filter === "all") return true;
  return filiere === filter;
}

function formatPrice(value: number | null): string {
  if (value === null) return "—";
  return `${value.toFixed(2)} €`;
}

// Affichage compact fourchette TerrOir : "16-22 €/kg (~19)" ou "—" si rien.
function formatTerroirRange(row: GmsPriceRow): string {
  const min = row.prix_terroir_kg_min;
  const max = row.prix_terroir_kg_max;
  const moyen = row.prix_terroir_kg_moyen;
  if (min === null && max === null && moyen === null) return "—";
  const range =
    min !== null && max !== null
      ? `${min.toFixed(2)}-${max.toFixed(2)} €`
      : moyen !== null
        ? `${moyen.toFixed(2)} €`
        : "—";
  if (moyen !== null && (min !== null || max !== null)) {
    return `${range} (~${moyen.toFixed(2)})`;
  }
  return range;
}

export default function AdminGmsPricesPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [showArchived, setShowArchived] = useState(false);
  const [rows, setRows] = useState<GmsPriceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<GmsPriceRow | null>(null);
  const [updatingPrices, setUpdatingPrices] = useState<GmsPriceRow | null>(
    null,
  );

  const refresh = async () => {
    setLoading(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    let query = supabase
      .from("gms_prices")
      .select(
        "id, slug, filiere, libelle, description_courte, prix_gms_kg, prix_terroir_kg_min, prix_terroir_kg_max, prix_terroir_kg_moyen, mois_reference, source, source_url, ordre_affichage, notes_admin, active",
      );
    if (!showArchived) {
      query = query.eq("active", true);
    }
    const { data, error: fetchError } = await query.order("ordre_affichage", {
      ascending: true,
    });
    if (fetchError) {
      setError(fetchError.message);
      setLoading(false);
      return;
    }
    setRows((data ?? []) as GmsPriceRow[]);
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);

  const counts = useMemo(
    () => ({
      all: rows.length,
      bovin: rows.filter((r) => r.filiere === "bovin").length,
      porcin: rows.filter((r) => r.filiere === "porcin").length,
      ovin: rows.filter((r) => r.filiere === "ovin").length,
    }),
    [rows],
  );

  const filtered = rows.filter((r) => matchesFilter(r.filiere, filter));

  const subtitle = `${counts.all} référence${counts.all > 1 ? "s" : ""} · ${counts.bovin} bovin · ${counts.porcin} porcin · ${counts.ovin} ovin`;

  // Soft delete bidirectionnel via POST /[id]/archive { action }. Toggle en
  // place dans le state pour feedback immédiat ; refresh complet en cas d'erreur.
  const toggleArchive = async (row: GmsPriceRow) => {
    const action = row.active ? "archive" : "restore";
    const label = row.active ? "archiver" : "restaurer";
    if (
      !window.confirm(
        `Voulez-vous ${label} la référence "${row.libelle}" ?`,
      )
    ) {
      return;
    }
    setBusy(row.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/gms-prices/${row.id}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Erreur réseau" }));
        setError(body.error ?? `Erreur ${res.status}`);
        return;
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div>
        <AdminPageHeader
          eyebrow="Catalogue"
          title="Prix GMS"
          subtitle={subtitle}
          error={error}
          right={
            <Button
              variant="accent"
              size="lg"
              onClick={() => setCreating(true)}
            >
              + Nouvelle référence
            </Button>
          }
        />

        <div className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-gray-200">
          <FilterTabs<Filter>
            filters={BASE_FILTERS}
            counts={counts}
            active={filter}
            onChange={setFilter}
          />
          <label className="-mb-px inline-flex cursor-pointer items-center gap-2 pb-3 text-[12px] text-gray-600 hover:text-gray-900">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-gray-300 text-terroir-green-700 focus:ring-terroir-green-700"
            />
            <span>Inclure archivées</span>
          </label>
        </div>

        <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-100 text-left text-[11px] uppercase tracking-[0.14em] text-gray-600">
                  <th className="px-5 py-3 font-semibold">Référence</th>
                  <th className="px-5 py-3 font-semibold">Filière</th>
                  <th className="px-5 py-3 font-semibold">Prix GMS</th>
                  <th className="px-5 py-3 font-semibold">Prix TerrOir</th>
                  <th className="px-5 py-3 font-semibold">Mois ref.</th>
                  <th className="px-5 py-3 font-semibold">Statut</th>
                  <th className="px-5 py-3 text-right font-semibold">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <TableStatus kind="loading" colSpan={7} />
                ) : filtered.length === 0 ? (
                  <TableStatus
                    kind="empty"
                    colSpan={7}
                    emptyLabel="Aucune référence."
                  />
                ) : (
                  filtered.map((row) => {
                    const disabled = busy === row.id;
                    return (
                      <tr
                        key={row.id}
                        className="border-b border-gray-200 last:border-0 hover:bg-gray-50"
                      >
                        <td className="px-5 py-4">
                          <div className="font-serif text-[17px] leading-tight text-gray-900">
                            {row.libelle}
                          </div>
                          <div className="mt-0.5 font-mono text-[11px] text-gray-500">
                            {row.slug}
                          </div>
                        </td>
                        <td className="px-5 py-4 text-gray-700">
                          {FILIERE_LABEL[row.filiere]}
                        </td>
                        <td className="px-5 py-4 font-mono text-gray-700">
                          {formatPrice(row.prix_gms_kg)}
                          <span className="ml-1 text-[11px] text-gray-500">
                            /kg
                          </span>
                        </td>
                        <td className="px-5 py-4 font-mono text-gray-700">
                          {formatTerroirRange(row)}
                        </td>
                        <td className="px-5 py-4 font-mono text-[13px] text-gray-500">
                          {row.mois_reference}
                        </td>
                        <td className="px-5 py-4">
                          {row.active ? (
                            <StatusDotBadge
                              label="Active"
                              bg="bg-terroir-green-100"
                              text="text-terroir-green-700"
                              dot="bg-terroir-green-700"
                            />
                          ) : (
                            <StatusDotBadge
                              label="Archivée"
                              bg="bg-gray-100"
                              text="text-gray-600"
                              dot="bg-gray-400"
                            />
                          )}
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <TableActionButton
                              variant="primary"
                              onClick={() => setUpdatingPrices(row)}
                              disabled={disabled || !row.active}
                              title={
                                !row.active
                                  ? "Restaurer la référence avant de mettre à jour les prix"
                                  : undefined
                              }
                            >
                              Mise à jour mensuelle
                            </TableActionButton>
                            <TableActionButton
                              variant="ghost"
                              onClick={() => setEditing(row)}
                              disabled={disabled}
                            >
                              Modifier
                            </TableActionButton>
                            {row.active ? (
                              <TableActionButton
                                variant="ghost-danger"
                                onClick={() => toggleArchive(row)}
                                disabled={disabled}
                              >
                                Archiver
                              </TableActionButton>
                            ) : (
                              <TableActionButton
                                variant="ghost"
                                onClick={() => toggleArchive(row)}
                                disabled={disabled}
                              >
                                Restaurer
                              </TableActionButton>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {creating && (
        <CreateGmsPriceModal
          onClose={() => setCreating(false)}
          onSuccess={() => {
            setCreating(false);
            void refresh();
          }}
        />
      )}
      {editing && (
        <EditGmsPriceModal
          row={editing}
          onClose={() => setEditing(null)}
          onSuccess={() => {
            setEditing(null);
            void refresh();
          }}
        />
      )}
      {updatingPrices && (
        <MonthlyUpdateModal
          row={updatingPrices}
          onClose={() => setUpdatingPrices(null)}
          onSuccess={() => {
            setUpdatingPrices(null);
            void refresh();
          }}
        />
      )}
    </>
  );
}
