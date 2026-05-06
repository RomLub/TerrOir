import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProductCategory } from "@/lib/products/types";
import {
  AdminCategorisationDeleteBlocked,
  AdminCategorisationSlugDuplicate,
  isUniqueViolation,
} from "./errors";

// Helpers admin CRUD pour public.product_categories (T-130).
//
// Schéma figé par migration T-220 PR-A : id, slug (unique), name, sort_order,
// created_at. Pas de updated_at sur la table (cf. migration), pas de
// updated_by — la traçabilité passe par audit_logs côté route.
//
// Pattern AdminWriteResult : { ok: true, data } | { ok: false, error }
// aligné avec lib/gms-prices/admin-write.ts. Exception : delete throw
// AdminCategorisationDeleteBlocked si dépendances > 0 (filet applicatif
// avant que le ON DELETE SET NULL DB ne s'enclenche silencieusement).
//
// Slug duplicate : INSERT/UPDATE retournent { ok: false } AVEC throw
// AdminCategorisationSlugDuplicate pour que la route route en 409 distinct
// du 500 générique. Pré-check serait race-prone (entre check et insert).

export interface CategoryCreateInput {
  slug: string;
  name: string;
  sort_order: number;
}

export interface CategoryUpdateInput {
  slug: string;
  name: string;
  sort_order: number;
}

export type AdminWriteResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// READ ----------------------------------------------------------------------

export async function listCategories(
  admin: SupabaseClient,
): Promise<ProductCategory[]> {
  const { data, error } = await admin
    .from("product_categories")
    .select("id, slug, name, sort_order")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) {
    console.error(`CATEGORIES_LIST_ERROR error=${error.message}`);
    throw new Error(error.message);
  }
  return (data ?? []) as ProductCategory[];
}

export async function getCategory(
  admin: SupabaseClient,
  id: string,
): Promise<ProductCategory | null> {
  const { data, error } = await admin
    .from("product_categories")
    .select("id, slug, name, sort_order")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error(`CATEGORIES_GET_ERROR id=${id} error=${error.message}`);
    throw new Error(error.message);
  }
  return (data as ProductCategory | null) ?? null;
}

// DEPENDENCIES --------------------------------------------------------------

export async function countCategoryDependencies(
  admin: SupabaseClient,
  id: string,
): Promise<{ products: number }> {
  const { count, error } = await admin
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("category_id", id);
  if (error) {
    console.error(
      `CATEGORIES_COUNT_DEPS_ERROR id=${id} error=${error.message}`,
    );
    throw new Error(error.message);
  }
  return { products: count ?? 0 };
}

// WRITE ---------------------------------------------------------------------

export async function createCategory(
  admin: SupabaseClient,
  input: CategoryCreateInput,
): Promise<AdminWriteResult<{ id: string }>> {
  const { data, error } = await admin
    .from("product_categories")
    .insert({
      slug: input.slug,
      name: input.name,
      sort_order: input.sort_order,
    })
    .select("id")
    .single();
  if (error || !data) {
    if (isUniqueViolation(error)) {
      throw new AdminCategorisationSlugDuplicate("category", input.slug);
    }
    console.error(
      `CATEGORIES_CREATE_ERROR slug=${input.slug} error=${error?.message ?? "no data"}`,
    );
    return { ok: false, error: error?.message ?? "Insert failed" };
  }
  return { ok: true, data: { id: (data as { id: string }).id } };
}

export async function updateCategory(
  admin: SupabaseClient,
  id: string,
  input: CategoryUpdateInput,
): Promise<AdminWriteResult<null>> {
  const { error } = await admin
    .from("product_categories")
    .update({
      slug: input.slug,
      name: input.name,
      sort_order: input.sort_order,
    })
    .eq("id", id);
  if (error) {
    if (isUniqueViolation(error)) {
      throw new AdminCategorisationSlugDuplicate("category", input.slug);
    }
    console.error(`CATEGORIES_UPDATE_ERROR id=${id} error=${error.message}`);
    return { ok: false, error: error.message };
  }
  return { ok: true, data: null };
}

// Hard delete avec garde-fou applicatif (cf. décision Romain LOT 1) :
// on count d'abord les produits liés, on throw si > 0. Le ON DELETE SET NULL
// DB reste comme filet de sécurité pour les corner cases (suppression hors
// flow normal type SQL Studio), mais la route ne doit jamais l'enclencher.
export async function deleteCategory(
  admin: SupabaseClient,
  id: string,
): Promise<AdminWriteResult<null>> {
  const deps = await countCategoryDependencies(admin, id);
  if (deps.products > 0) {
    throw new AdminCategorisationDeleteBlocked("category", {
      products: deps.products,
    });
  }
  const { error } = await admin
    .from("product_categories")
    .delete()
    .eq("id", id);
  if (error) {
    console.error(`CATEGORIES_DELETE_ERROR id=${id} error=${error.message}`);
    return { ok: false, error: error.message };
  }
  return { ok: true, data: null };
}
