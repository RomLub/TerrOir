"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
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
  CutFormModal,
  type CutRow,
  type AnimalOption,
} from "../_components/CutFormModal";

// Page admin /admin/categorisation/morceaux — T-130. Particularités cuts :
//   - scoping animal_id : un cut appartient à 1 animal (UNIQUE composite)
//   - filtre query param ?animal=<slug> pour deep-linking depuis la page
//     animaux (ex: cliquer sur un animal → voir ses morceaux)
//   - colonne animal affichée explicitement dans le tableau

type Row = CutRow & {
  animal_name: string;
  animal_slug: string;
  product_count: number;
};

export default function AdminCutsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const animalFilterSlug = searchParams.get("animal");

  const [animals, setAnimals] = useState<AnimalOption[]>([]);
  const [animalSlugToId, setAnimalSlugToId] = useState<Map<string, string>>(
    new Map(),
  );
  const [animalIdToData, setAnimalIdToData] = useState<
    Map<string, { name: string; slug: string }>
  >(new Map());
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CutRow | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();

    const [animalsRes, cutsRes, productsRes] = await Promise.all([
      supabase
        .from("animals")
        .select("id, slug, name, sort_order")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("cuts")
        .select("id, animal_id, slug, name, sort_order")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase.from("products").select("cut_id"),
    ]);
    if (animalsRes.error) {
      setError(animalsRes.error.message);
      setLoading(false);
      return;
    }
    if (cutsRes.error) {
      setError(cutsRes.error.message);
      setLoading(false);
      return;
    }
    if (productsRes.error) {
      setError(productsRes.error.message);
      setLoading(false);
      return;
    }

    const animalsList = (animalsRes.data ?? []) as Array<{
      id: string;
      slug: string;
      name: string;
      sort_order: number;
    }>;

    const slugToId = new Map<string, string>();
    const idToData = new Map<string, { name: string; slug: string }>();
    for (const a of animalsList) {
      slugToId.set(a.slug, a.id);
      idToData.set(a.id, { name: a.name, slug: a.slug });
    }
    setAnimals(animalsList.map((a) => ({ id: a.id, name: a.name })));
    setAnimalSlugToId(slugToId);
    setAnimalIdToData(idToData);

    const productCounts = new Map<string, number>();
    for (const p of (productsRes.data ?? []) as { cut_id: string | null }[]) {
      if (p.cut_id) {
        productCounts.set(p.cut_id, (productCounts.get(p.cut_id) ?? 0) + 1);
      }
    }

    const enriched: Row[] = ((cutsRes.data ?? []) as CutRow[]).map((c) => {
      const animal = idToData.get(c.animal_id);
      return {
        ...c,
        animal_name: animal?.name ?? "—",
        animal_slug: animal?.slug ?? "",
        product_count: productCounts.get(c.id) ?? 0,
      };
    });
    setRows(enriched);
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
  }, []);

  // Filtre par animal_id résolu depuis le slug query param. Si le slug ne
  // matche aucun animal connu, on ignore (filter inactif) plutôt que de
  // crasher — pratique pour les liens cassés ou animaux supprimés.
  const filterAnimalId = animalFilterSlug
    ? (animalSlugToId.get(animalFilterSlug) ?? null)
    : null;

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filterAnimalId && r.animal_id !== filterAnimalId) return false;
      return matchesSearch(r, search);
    });
  }, [rows, search, filterAnimalId]);

  const handleDelete = async (row: Row) => {
    if (row.product_count > 0) return;
    if (
      !window.confirm(
        `Supprimer le morceau "${row.name}" (${row.animal_name}) ?`,
      )
    )
      return;
    setBusy(row.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/cuts/${row.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 409 && body.error === "delete_blocked") {
          setError(formatDeleteBlockedMessage("cut", body.dependencies ?? {}));
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

  const clearAnimalFilter = () => {
    router.push(pathname);
  };

  const subtitle = filterAnimalId
    ? `${filtered.length} morceau${filtered.length > 1 ? "x" : ""} pour ${animalIdToData.get(filterAnimalId)?.name ?? "—"}`
    : `${rows.length} morceau${rows.length > 1 ? "x" : ""}`;

  return (
    <>
      <AdminPageHeader
        eyebrow="Catalogue"
        title="Morceaux"
        subtitle={subtitle}
        error={error}
        right={
          <Button
            variant="primary"
            size="lg"
            onClick={() => setCreating(true)}
            disabled={animals.length === 0}
          >
            + Nouveau morceau
          </Button>
        }
      />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-3">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="search"
            placeholder="Rechercher par nom ou slug…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-72 rounded-md border border-gray-300 px-3 py-2 text-[13px] placeholder:text-gray-400 focus:border-terroir-green-700 focus:outline-none focus:ring-2 focus:ring-terroir-green-700"
          />
          {animalFilterSlug && (
            <button
              type="button"
              onClick={clearAnimalFilter}
              className="rounded-full border border-gray-300 px-3 py-1 text-[12px] text-gray-700 hover:bg-gray-100"
            >
              Filtre : {animalFilterSlug} ✕
            </button>
          )}
        </div>
        <p className="text-[12px] text-gray-500">
          Tri par ordre puis nom
        </p>
      </div>

      <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-100 text-left text-[11px] uppercase tracking-[0.14em] text-gray-600">
                <th className="px-5 py-3 font-semibold">Morceau</th>
                <th className="px-5 py-3 font-semibold">Animal</th>
                <th className="px-5 py-3 font-semibold">Slug</th>
                <th className="px-5 py-3 font-semibold">Ordre</th>
                <th className="px-5 py-3 font-semibold">Produits</th>
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
                    search.trim() || filterAnimalId
                      ? "Aucun morceau ne correspond aux filtres."
                      : "Aucun morceau."
                  }
                />
              ) : (
                filtered.map((row) => {
                  const blocked = row.product_count > 0;
                  const disabled = busy === row.id;
                  const blockedMsg = blocked
                    ? formatDeleteBlockedMessage("cut", {
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
                      <td className="px-5 py-4 text-gray-700">
                        {row.animal_name}
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
        <CutFormModal
          animals={animals}
          preselectedAnimalId={filterAnimalId ?? undefined}
          mode={{ kind: "create" }}
          onClose={() => setCreating(false)}
          onSuccess={() => {
            setCreating(false);
            void refresh();
          }}
        />
      )}
      {editing && (
        <CutFormModal
          animals={animals}
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
