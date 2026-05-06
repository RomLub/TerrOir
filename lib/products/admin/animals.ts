import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Animal } from "@/lib/products/types";
import {
  AdminCategorisationDeleteBlocked,
  AdminCategorisationSlugDuplicate,
  isUniqueViolation,
} from "./errors";

// Helpers admin CRUD pour public.animals (T-130).
//
// Schéma figé par migration T-220 PR-A : id, slug (unique), name, sort_order,
// created_at. Cohérent avec product_categories (même shape).
//
// Particularité animals : 2 dépendances bloquantes la suppression — produits
// (animal_id) ET cuts (animal_id, ON DELETE RESTRICT côté DB). Les 2 cas
// remontés séparément côté UI pour message clair :
//   "X produit(s) + Y morceau(x) lié(s) à cette espèce. Re-tagguer / supprimer
//    avant de retirer l'espèce."

export interface AnimalCreateInput {
  slug: string;
  name: string;
  sort_order: number;
}

export interface AnimalUpdateInput {
  slug: string;
  name: string;
  sort_order: number;
}

export type AdminWriteResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// READ ----------------------------------------------------------------------

export async function listAnimals(
  admin: SupabaseClient,
): Promise<Animal[]> {
  const { data, error } = await admin
    .from("animals")
    .select("id, slug, name, sort_order")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) {
    console.error(`ANIMALS_LIST_ERROR error=${error.message}`);
    throw new Error(error.message);
  }
  return (data ?? []) as Animal[];
}

export async function getAnimal(
  admin: SupabaseClient,
  id: string,
): Promise<Animal | null> {
  const { data, error } = await admin
    .from("animals")
    .select("id, slug, name, sort_order")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error(`ANIMALS_GET_ERROR id=${id} error=${error.message}`);
    throw new Error(error.message);
  }
  return (data as Animal | null) ?? null;
}

// DEPENDENCIES --------------------------------------------------------------

export async function countAnimalDependencies(
  admin: SupabaseClient,
  id: string,
): Promise<{ products: number; cuts: number }> {
  const [productsRes, cutsRes] = await Promise.all([
    admin
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("animal_id", id),
    admin
      .from("cuts")
      .select("id", { count: "exact", head: true })
      .eq("animal_id", id),
  ]);
  if (productsRes.error) {
    console.error(
      `ANIMALS_COUNT_PRODUCTS_ERROR id=${id} error=${productsRes.error.message}`,
    );
    throw new Error(productsRes.error.message);
  }
  if (cutsRes.error) {
    console.error(
      `ANIMALS_COUNT_CUTS_ERROR id=${id} error=${cutsRes.error.message}`,
    );
    throw new Error(cutsRes.error.message);
  }
  return {
    products: productsRes.count ?? 0,
    cuts: cutsRes.count ?? 0,
  };
}

// WRITE ---------------------------------------------------------------------

export async function createAnimal(
  admin: SupabaseClient,
  input: AnimalCreateInput,
): Promise<AdminWriteResult<{ id: string }>> {
  const { data, error } = await admin
    .from("animals")
    .insert({
      slug: input.slug,
      name: input.name,
      sort_order: input.sort_order,
    })
    .select("id")
    .single();
  if (error || !data) {
    if (isUniqueViolation(error)) {
      throw new AdminCategorisationSlugDuplicate("animal", input.slug);
    }
    console.error(
      `ANIMALS_CREATE_ERROR slug=${input.slug} error=${error?.message ?? "no data"}`,
    );
    return { ok: false, error: error?.message ?? "Insert failed" };
  }
  return { ok: true, data: { id: (data as { id: string }).id } };
}

export async function updateAnimal(
  admin: SupabaseClient,
  id: string,
  input: AnimalUpdateInput,
): Promise<AdminWriteResult<null>> {
  const { error } = await admin
    .from("animals")
    .update({
      slug: input.slug,
      name: input.name,
      sort_order: input.sort_order,
    })
    .eq("id", id);
  if (error) {
    if (isUniqueViolation(error)) {
      throw new AdminCategorisationSlugDuplicate("animal", input.slug);
    }
    console.error(`ANIMALS_UPDATE_ERROR id=${id} error=${error.message}`);
    return { ok: false, error: error.message };
  }
  return { ok: true, data: null };
}

// Hard delete avec garde-fou applicatif. Si products > 0 OU cuts > 0,
// throw avec les 2 counts pour message UI précis. Le ON DELETE RESTRICT
// (cuts) et SET NULL (products) côté DB restent comme filet de sécurité.
export async function deleteAnimal(
  admin: SupabaseClient,
  id: string,
): Promise<AdminWriteResult<null>> {
  const deps = await countAnimalDependencies(admin, id);
  if (deps.products > 0 || deps.cuts > 0) {
    throw new AdminCategorisationDeleteBlocked("animal", {
      products: deps.products,
      cuts: deps.cuts,
    });
  }
  const { error } = await admin.from("animals").delete().eq("id", id);
  if (error) {
    console.error(`ANIMALS_DELETE_ERROR id=${id} error=${error.message}`);
    return { ok: false, error: error.message };
  }
  return { ok: true, data: null };
}
