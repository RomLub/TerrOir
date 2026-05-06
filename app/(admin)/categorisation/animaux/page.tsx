"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AdminPageHeader,
  Button,
  TableActionButton,
  TableStatus,
} from "@/components/ui";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  formatDeleteBlockedMessage,
  matchesSearch,
} from "../_lib/format-deps";
import {
  SimpleEntityFormModal,
  type SimpleRow,
} from "../_components/SimpleEntityFormModal";

// Page admin /admin/categorisation/animaux — T-130. Identique en structure
// à categories/page.tsx, mais affiche 2 colonnes de dépendances : produits
// taggés ET cuts liés. Le delete est bloqué si l'un des deux > 0.

type Row = SimpleRow & { product_count: number; cut_count: number };

export default function AdminAnimalsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SimpleRow | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();

    // 3 fetch parallèle : référentiel + produits.animal_id + cuts.animal_id.
    const [animalsRes, productsRes, cutsRes] = await Promise.all([
      supabase
        .from("animals")
        .select("id, slug, name, sort_order")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase.from("products").select("animal_id"),
      supabase.from("cuts").select("animal_id"),
    ]);
    if (animalsRes.error) {
      setError(animalsRes.error.message);
      setLoading(false);
      return;
    }
    if (productsRes.error) {
      setError(productsRes.error.message);
      setLoading(false);
      return;
    }
    if (cutsRes.error) {
      setError(cutsRes.error.message);
      setLoading(false);
      return;
    }

    const productCounts = new Map<string, number>();
    for (const p of (productsRes.data ?? []) as { animal_id: string | null }[]) {
      if (p.animal_id) {
        productCounts.set(p.animal_id, (productCounts.get(p.animal_id) ?? 0) + 1);
      }
    }
    const cutCounts = new Map<string, number>();
    for (const c of (cutsRes.data ?? []) as { animal_id: string }[]) {
      cutCounts.set(c.animal_id, (cutCounts.get(c.animal_id) ?? 0) + 1);
    }

    const enriched: Row[] = ((animalsRes.data ?? []) as SimpleRow[]).map(
      (a) => ({
        ...a,
        product_count: productCounts.get(a.id) ?? 0,
        cut_count: cutCounts.get(a.id) ?? 0,
      }),
    );
    setRows(enriched);
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const filtered = useMemo(
    () => rows.filter((r) => matchesSearch(r, search)),
    [rows, search],
  );

  const handleDelete = async (row: Row) => {
    if (row.product_count > 0 || row.cut_count > 0) return;
    if (!window.confirm(`Supprimer l'espèce "${row.name}" ?`)) return;
    setBusy(row.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/animals/${row.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 409 && body.error === "delete_blocked") {
          setError(formatDeleteBlockedMessage("animal", body.dependencies ?? {}));
          await refresh();
        } else {
          setError(body.error ?? `Erreur ${res.status}`);
        }
        return;
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const subtitle = `${rows.length} espèce${rows.length > 1 ? "s" : ""} animale${rows.length > 1 ? "s" : ""}`;

  return (
    <>
      <AdminPageHeader
        eyebrow="Catalogue"
        title="Espèces animales"
        subtitle={subtitle}
        error={error}
        right={
          <Button
            variant="primary"
            size="lg"
            onClick={() => setCreating(true)}
          >
            + Nouvelle espèce
          </Button>
        }
      />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-3">
        <input
          type="search"
          placeholder="Rechercher par nom ou slug…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-72 rounded-md border border-gray-300 px-3 py-2 text-[13px] placeholder:text-gray-400 focus:border-terroir-green-700 focus:outline-none focus:ring-2 focus:ring-terroir-green-700"
        />
        <p className="text-[12px] text-gray-500">
          Tri par ordre puis nom
        </p>
      </div>

      <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-100 text-left text-[11px] uppercase tracking-[0.14em] text-gray-600">
                <th className="px-5 py-3 font-semibold">Espèce</th>
                <th className="px-5 py-3 font-semibold">Slug</th>
                <th className="px-5 py-3 font-semibold">Ordre</th>
                <th className="px-5 py-3 font-semibold">Produits</th>
                <th className="px-5 py-3 font-semibold">Morceaux</th>
                <th className="px-5 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableStatus kind="loading" colSpan={6} />
              ) : filtered.length === 0 ? (
                <TableStatus
                  kind="empty"
                  colSpan={6}
                  emptyLabel={
                    search.trim()
                      ? "Aucune espèce ne correspond à la recherche."
                      : "Aucune espèce animale."
                  }
                />
              ) : (
                filtered.map((row) => {
                  const blocked = row.product_count > 0 || row.cut_count > 0;
                  const disabled = busy === row.id;
                  const blockedMsg = blocked
                    ? formatDeleteBlockedMessage("animal", {
                        products: row.product_count,
                        cuts: row.cut_count,
                      })
                    : undefined;
                  return (
                    <tr
                      key={row.id}
                      className="border-b border-gray-200 last:border-0 hover:bg-gray-50"
                    >
                      <td className="px-5 py-4">
                        <div className="font-serif text-[17px] leading-tight text-gray-900">
                          {row.name}
                        </div>
                      </td>
                      <td className="px-5 py-4 font-mono text-[12px] text-gray-500">
                        {row.slug}
                      </td>
                      <td className="px-5 py-4 font-mono text-gray-700">
                        {row.sort_order}
                      </td>
                      <td className="px-5 py-4 text-gray-700">
                        {row.product_count}
                      </td>
                      <td className="px-5 py-4 text-gray-700">
                        {row.cut_count}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <TableActionButton
                            variant="ghost"
                            onClick={() => setEditing(row)}
                            disabled={disabled}
                          >
                            Modifier
                          </TableActionButton>
                          <TableActionButton
                            variant="ghost-danger"
                            onClick={() => handleDelete(row)}
                            disabled={disabled || blocked}
                            title={blockedMsg}
                          >
                            Supprimer
                          </TableActionButton>
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

      {creating && (
        <SimpleEntityFormModal
          resourceLabel="espèce animale"
          apiPath="/api/admin/animals"
          mode={{ kind: "create" }}
          onClose={() => setCreating(false)}
          onSuccess={() => {
            setCreating(false);
            void refresh();
          }}
        />
      )}
      {editing && (
        <SimpleEntityFormModal
          resourceLabel="espèce animale"
          apiPath="/api/admin/animals"
          mode={{ kind: "edit", row: editing }}
          onClose={() => setEditing(null)}
          onSuccess={() => {
            setEditing(null);
            void refresh();
          }}
        />
      )}
    </>
  );
}
