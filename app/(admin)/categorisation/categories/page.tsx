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

// Page admin /admin/categorisation/categories — T-130.
// Pattern aligné app/(admin)/gms-prices/page.tsx :
//   - 'use client' complet
//   - READ direct via createSupabaseBrowserClient (RLS public read sur
//     product_categories, déjà acquis par migration T-220 PR-A)
//   - WRITE via fetch /api/admin/categories/* (jamais service_role côté client)
//   - error inline dans AdminPageHeader (pas de toast lib dans le repo)

type Row = SimpleRow & { product_count: number };

export default function AdminCategoriesPage() {
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

    // Fetch parallèle : 1) référentiel catégories, 2) produits (juste
    // category_id) pour comptage local. Le volume reste minimal (~7 cats,
    // ~16 produits actuellement). Si un jour le catalogue dépasse plusieurs
    // milliers, basculer sur un RPC d'agrégation côté DB.
    const [catsRes, productsRes] = await Promise.all([
      supabase
        .from("product_categories")
        .select("id, slug, name, sort_order")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase.from("products").select("category_id"),
    ]);
    if (catsRes.error) {
      setError(catsRes.error.message);
      setLoading(false);
      return;
    }
    if (productsRes.error) {
      setError(productsRes.error.message);
      setLoading(false);
      return;
    }

    const counts = new Map<string, number>();
    for (const p of (productsRes.data ?? []) as { category_id: string | null }[]) {
      if (p.category_id) {
        counts.set(p.category_id, (counts.get(p.category_id) ?? 0) + 1);
      }
    }

    const enriched: Row[] = ((catsRes.data ?? []) as SimpleRow[]).map((c) => ({
      ...c,
      product_count: counts.get(c.id) ?? 0,
    }));
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
    // Garde-fou UI : déjà gardé par disabled bouton, defensive double-check.
    if (row.product_count > 0) return;
    if (!window.confirm(`Supprimer la catégorie "${row.name}" ?`)) return;
    setBusy(row.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/categories/${row.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 409 && body.error === "delete_blocked") {
          // Race : un produit a été tagué entre count et DELETE. On affiche
          // le message exact serveur et on refresh.
          setError(formatDeleteBlockedMessage("category", body.dependencies ?? {}));
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

  const subtitle = `${rows.length} catégorie${rows.length > 1 ? "s" : ""}`;

  return (
    <>
      <AdminPageHeader
        eyebrow="Catalogue"
        title="Catégories produits"
        subtitle={subtitle}
        error={error}
        right={
          <Button
            variant="primary"
            size="lg"
            onClick={() => setCreating(true)}
          >
            + Nouvelle catégorie
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
                <th className="px-5 py-3 font-semibold">Catégorie</th>
                <th className="px-5 py-3 font-semibold">Slug</th>
                <th className="px-5 py-3 font-semibold">Ordre</th>
                <th className="px-5 py-3 font-semibold">Produits liés</th>
                <th className="px-5 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableStatus kind="loading" colSpan={5} />
              ) : filtered.length === 0 ? (
                <TableStatus
                  kind="empty"
                  colSpan={5}
                  emptyLabel={
                    search.trim()
                      ? "Aucune catégorie ne correspond à la recherche."
                      : "Aucune catégorie."
                  }
                />
              ) : (
                filtered.map((row) => {
                  const blocked = row.product_count > 0;
                  const disabled = busy === row.id;
                  const blockedMsg = blocked
                    ? formatDeleteBlockedMessage("category", {
                        products: row.product_count,
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
          resourceLabel="catégorie"
          apiPath="/api/admin/categories"
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
          resourceLabel="catégorie"
          apiPath="/api/admin/categories"
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
