"use client";

import { useState, type FormEvent } from "react";
import { AdminModal, Input, Select } from "@/components/ui";

// Modal create/edit pour les morceaux (cuts) — T-130. Étend le pattern
// SimpleEntityFormModal avec un select animal_id obligatoire (cuts est
// scoped par animal_id côté schéma, UNIQUE composite (animal_id, slug)).

export type CutRow = {
  id: string;
  animal_id: string;
  slug: string;
  name: string;
  sort_order: number;
};

export type AnimalOption = { id: string; name: string };

type Mode = { kind: "create" } | { kind: "edit"; row: CutRow };

type Props = {
  animals: AnimalOption[];
  // Pré-sélection animal_id en mode create (utile depuis le filtre liste).
  preselectedAnimalId?: string;
  mode: Mode;
  onClose: () => void;
  onSuccess: () => void;
};

export function CutFormModal({
  animals,
  preselectedAnimalId,
  mode,
  onClose,
  onSuccess,
}: Props) {
  const initial = mode.kind === "edit" ? mode.row : null;
  const [animalId, setAnimalId] = useState(
    initial?.animal_id ?? preselectedAnimalId ?? "",
  );
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [sortOrder, setSortOrder] = useState(
    initial ? String(initial.sort_order) : "100",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const payload = {
      animal_id: animalId,
      slug: slug.trim(),
      name: name.trim(),
      sort_order: Number(sortOrder),
    };

    const url =
      mode.kind === "create"
        ? "/api/admin/cuts"
        : `/api/admin/cuts/${mode.row.id}`;
    const method = mode.kind === "create" ? "POST" : "PATCH";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 409 && body.error === "slug_duplicate") {
          setError(
            `Le slug "${body.slug ?? slug}" est déjà utilisé pour cet animal. Choisissez un autre slug.`,
          );
        } else {
          setError(body.error ?? `Erreur ${res.status}`);
        }
        return;
      }
      onSuccess();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const isEdit = mode.kind === "edit";
  const title = isEdit ? `Modifier "${initial?.name ?? ""}"` : "Nouveau morceau";

  return (
    <AdminModal
      open
      onClose={onClose}
      eyebrow={isEdit ? "Édition" : "Création"}
      title={title}
      size="md"
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
            form="categorisation-cut-form"
            disabled={submitting || !animalId}
            className="rounded-md bg-terroir-green-700 px-4 py-2 text-[14px] font-semibold text-white transition-colors hover:bg-terroir-green-700/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isEdit
              ? submitting
                ? "Enregistrement…"
                : "Enregistrer"
              : submitting
                ? "Création…"
                : "Créer le morceau"}
          </button>
        </>
      }
    >
      <form
        id="categorisation-cut-form"
        onSubmit={submit}
        className="mt-4 space-y-4"
      >
        <Select
          name="animal_id"
          label="Espèce animale"
          placeholder="Choisir…"
          options={animals.map((a) => ({ value: a.id, label: a.name }))}
          value={animalId}
          onChange={(e) => setAnimalId(e.target.value)}
          required
          disabled={submitting}
          hint="Le morceau sera lié à cette espèce. La cohérence avec les produits taggés est gérée côté form producteur."
        />
        <Input
          name="slug"
          label="Slug"
          placeholder="ex: epaule"
          hint="Kebab-case. Unique scopé par espèce (slug 'cote' OK pour bœuf ET veau)."
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          required
          pattern="[a-z0-9-]+"
          maxLength={80}
          disabled={submitting}
        />
        <Input
          name="name"
          label="Nom"
          placeholder="ex: Épaule"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={100}
          disabled={submitting}
        />
        <Input
          name="sort_order"
          label="Ordre d'affichage"
          type="number"
          step="1"
          min="0"
          max="10000"
          hint="Tri ASC. Garder de l'espace entre valeurs (10, 20, 30…)."
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
          required
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
