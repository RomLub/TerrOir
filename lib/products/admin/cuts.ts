import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Cut } from "@/lib/products/types";
import {
  AdminCategorisationDeleteBlocked,
  AdminCategorisationSlugDuplicate,
  isUniqueViolation,
} from "./errors";

// Helpers admin CRUD pour public.cuts (T-130).
//
// Schéma figé par migration T-220 PR-A : id, animal_id (FK ON DELETE
// RESTRICT), slug, name, sort_order, created_at + UNIQUE (animal_id, slug).
// Le slug n'est PAS unique global mais scoped par animal_id — un même
// "entrecote" peut exister pour boeuf et veau si jamais l'extension cuts
// hors-bovin se fait (MVP : seul boeuf a 30 cuts seedés).
//
// La cohérence cross-FK products.animal_id == cuts.animal_id n'est pas
// vérifiée en DB (cf. migration commentaire) — c'est l'UI/API producer qui
// la garantit. Côté admin, on n'y touche pas dans cette session : cuts est
// simplement scopé par son animal_id propre.

export interface CutCreateInput {
  animal_id: string;
  slug: string;
  name: string;
  sort_order: number;
}

export interface CutUpdateInput {
  animal_id: string;
  slug: string;
  name: string;
  sort_order: number;
}

export type AdminWriteResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// READ ----------------------------------------------------------------------

export async function listCuts(
  admin: SupabaseClient,
  filters?: { animal_id?: string },
): Promise<Cut[]> {
  let query = admin
    .from("cuts")
    .select("id, animal_id, slug, name, sort_order");
  if (filters?.animal_id) {
    query = query.eq("animal_id", filters.animal_id);
  }
  const { data, error } = await query
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) {
    console.error(`CUTS_LIST_ERROR error=${error.message}`);
    throw new Error(error.message);
  }
  return (data ?? []) as Cut[];
}

export async function getCut(
  admin: SupabaseClient,
  id: string,
): Promise<Cut | null> {
  const { data, error } = await admin
    .from("cuts")
    .select("id, animal_id, slug, name, sort_order")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error(`CUTS_GET_ERROR id=${id} error=${error.message}`);
    throw new Error(error.message);
  }
  return (data as Cut | null) ?? null;
}

// DEPENDENCIES --------------------------------------------------------------

export async function countCutDependencies(
  admin: SupabaseClient,
  id: string,
): Promise<{ products: number }> {
  const { count, error } = await admin
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("cut_id", id);
  if (error) {
    console.error(`CUTS_COUNT_DEPS_ERROR id=${id} error=${error.message}`);
    throw new Error(error.message);
  }
  return { products: count ?? 0 };
}

// WRITE ---------------------------------------------------------------------

export async function createCut(
  admin: SupabaseClient,
  input: CutCreateInput,
): Promise<AdminWriteResult<{ id: string }>> {
  const { data, error } = await admin
    .from("cuts")
    .insert({
      animal_id: input.animal_id,
      slug: input.slug,
      name: input.name,
      sort_order: input.sort_order,
    })
    .select("id")
    .single();
  if (error || !data) {
    if (isUniqueViolation(error)) {
      // Slug duplicate scoped par animal_id. On expose juste le slug —
      // l'UI sait à quel animal_id l'admin était en train d'attribuer
      // ce slug (contexte form local).
      throw new AdminCategorisationSlugDuplicate("cut", input.slug);
    }
    console.error(
      `CUTS_CREATE_ERROR animal_id=${input.animal_id} slug=${input.slug} error=${error?.message ?? "no data"}`,
    );
    return { ok: false, error: error?.message ?? "Insert failed" };
  }
  return { ok: true, data: { id: (data as { id: string }).id } };
}

export async function updateCut(
  admin: SupabaseClient,
  id: string,
  input: CutUpdateInput,
): Promise<AdminWriteResult<null>> {
  const { error } = await admin
    .from("cuts")
    .update({
      animal_id: input.animal_id,
      slug: input.slug,
      name: input.name,
      sort_order: input.sort_order,
    })
    .eq("id", id);
  if (error) {
    if (isUniqueViolation(error)) {
      throw new AdminCategorisationSlugDuplicate("cut", input.slug);
    }
    console.error(`CUTS_UPDATE_ERROR id=${id} error=${error.message}`);
    return { ok: false, error: error.message };
  }
  return { ok: true, data: null };
}

// Hard delete avec garde-fou applicatif. Le ON DELETE SET NULL (products)
// côté DB reste comme filet — l'API ne doit jamais l'enclencher en flux
// normal. Pas de cuts.cuts dépendance (les cuts ne s'imbriquent pas).
export async function deleteCut(
  admin: SupabaseClient,
  id: string,
): Promise<AdminWriteResult<null>> {
  const deps = await countCutDependencies(admin, id);
  if (deps.products > 0) {
    throw new AdminCategorisationDeleteBlocked("cut", {
      products: deps.products,
    });
  }
  const { error } = await admin.from("cuts").delete().eq("id", id);
  if (error) {
    console.error(`CUTS_DELETE_ERROR id=${id} error=${error.message}`);
    return { ok: false, error: error.message };
  }
  return { ok: true, data: null };
}
