"use client";

import { useState, type FormEvent } from "react";
import { AdminModal, Input } from "@/components/ui";

// Modal partagé pour create/edit des entités simples (slug + name +
// sort_order) — couvre product_categories ET animals (T-130). Cuts a son
// propre modal (CutFormModal) à cause du select animal_id supplémentaire.
//
// Pourquoi un seul composant pour 2 entités plutôt que 2 modaux dédiés :
// la structure du form est strictement identique (3 champs, même
// validation HTML5, même API contract). Dupliquer 2x ~120 LoC pour juste
// changer le wording n'apporte rien — on isole les différences via les
// props { resourceLabel, apiPath }.

export type SimpleRow = {
  id: string;
  slug: string;
  name: string;
  sort_order: number;
};

type Mode = { kind: "create" } | { kind: "edit"; row: SimpleRow };

type Props = {
  // Libellé FR au singulier (« catégorie » / « espèce animale »). Utilisé
  // dans le titre du modal + bouton submit. Le pluriel est dérivé pour les
  // messages d'erreur si besoin (pas utilisé pour l'instant).
  resourceLabel: string;
  // URL de l'endpoint API admin (ex: "/api/admin/categories"). Le modal
  // POST sur cette URL en mode create, et PATCH sur `${apiPath}/${id}` en
  // mode edit.
  apiPath: string;
  mode: Mode;
  onClose: () => void;
  onSuccess: () => void;
};

export function SimpleEntityFormModal({
  resourceLabel,
  apiPath,
  mode,
  onClose,
  onSuccess,
}: Props) {
  const initialRow = mode.kind === "edit" ? mode.row : null;
  const [slug, setSlug] = useState(initialRow?.slug ?? "");
  const [name, setName] = useState(initialRow?.name ?? "");
  const [sortOrder, setSortOrder] = useState(
    initialRow ? String(initialRow.sort_order) : "100",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const payload = {
      slug: slug.trim(),
      name: name.trim(),
      sort_order: Number(sortOrder),
    };

    const url =
      mode.kind === "create" ? apiPath : `${apiPath}/${mode.row.id}`;
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
            `Le slug "${body.slug ?? slug}" est déjà utilisé. Choisissez un autre slug.`,
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
  const title = isEdit
    ? `Modifier "${initialRow?.name ?? ""}"`
    : `Nouvelle ${resourceLabel}`;
  const submitLabel = isEdit
    ? submitting
      ? "Enregistrement…"
      : "Enregistrer"
    : submitting
      ? "Création…"
      : `Créer la ${resourceLabel}`;

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
            form="categorisation-simple-form"
            disabled={submitting}
            className="rounded-md bg-terroir-green-700 px-4 py-2 text-[14px] font-semibold text-white transition-colors hover:bg-terroir-green-700/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitLabel}
          </button>
        </>
      }
    >
      <form
        id="categorisation-simple-form"
        onSubmit={submit}
        className="mt-4 space-y-4"
      >
        <Input
          name="slug"
          label="Slug"
          placeholder="ex: fruits-rouges"
          hint="Kebab-case (a-z, 0-9, -). Identifiant URL-safe, modifiable."
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
          placeholder="ex: Fruits rouges"
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
          hint="Tri ASC. Garder de l'espace entre valeurs (10, 20, 30…) pour insertions futures."
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
