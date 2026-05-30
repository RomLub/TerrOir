import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProductsFilters } from './parse-search-params';

// F-049 (audit pré-launch 2026-05) : pagination cursor sur /produits.
// Le default 60 couvre le LCP first paint, et le max 100 borne le coût
// par requête (pas d'amplification possible côté client).
export const PRODUCTS_PAGE_LIMIT_DEFAULT = 60;
export const PRODUCTS_PAGE_LIMIT_MAX = 100;

// Fetch produits public pour la page /produits (T-220 PR-C).
//
// Pattern : résolution slug → {id, name} pour chaque filtre actif (1
// round-trip par filtre, max 3) puis query principale products avec inner
// join sur producers.statut='public'. Inner join obligatoire : le client
// admin (service_role) bypass la RLS, donc sans le filtre manuel on
// exposerait les produits de producers en draft.
//
// Décisions Q1-Q3 :
// - Q1 : badge ProductCard utilise priorité cut > animal > category, on
//   embed donc product_categories(slug,name), animals(slug,name) et
//   cuts(slug,name) pour que le composant page puisse trancher.
// - Q3 : si un slug fourni n'existe pas en DB, retourne immédiatement
//   { products: [], resolved } (résultats vides gracieux, pas de 404).
//
// Le retour inclut `resolved` pour permettre à la page d'afficher les
// pills avec le `name` réel de chaque référence (pas le slug brut).
//
// Volume actuel : 16 produits prod, donc fetch en bulk sans pagination.
// Si volumétrie explose, migrer vers RPC ou pagination cursor.

export type PublicProductRow = {
  id: string;
  nom: string;
  prix: number;
  unite: string | null;
  photos: string[] | null;
  stock_disponible: number | null;
  stock_illimite: boolean | null;
  // F-049 : created_at sélectionné pour permettre la cursor pagination
  // (ordre stable + lt('created_at', cursor)).
  created_at: string;
  // FK nullable transitoire pendant le backfill (cf. migration PR-A
  // 20260501002856). Toujours sélectionnés pour permettre les badges.
  category_id: string | null;
  animal_id: string | null;
  cut_id: string | null;
  // Référentiels embeds via PostgREST. Null si la FK est null en DB.
  product_categories: { slug: string; name: string } | null;
  animals: { slug: string; name: string } | null;
  cuts: { slug: string; name: string } | null;
  // Inner join : toujours présent côté lecture (pas null en runtime).
  producers: { slug: string; nom_exploitation: string };
};

export type FilterReference = {
  slug: string;
  id: string;
  name: string;
};

// Snapshot des résolutions DB des 3 filtres optionnels. Null pour un
// filtre absent OU pour un slug fourni mais introuvable en DB. La page
// /produits ne crée pas de pill pour un filtre null (cohérent avec
// l'absence de produits retournés dans ce cas — décision Q3).
export type ResolvedFilters = {
  category: FilterReference | null;
  animal: FilterReference | null;
  cut: FilterReference | null;
};

async function resolveSlugToReference(
  supabase: SupabaseClient,
  table: 'product_categories' | 'animals' | 'cuts',
  slug: string,
): Promise<{ id: string; name: string } | null> {
  const { data } = await supabase
    .from(table)
    .select('id, name')
    .eq('slug', slug)
    .maybeSingle();
  return (data as { id: string; name: string } | null) ?? null;
}

function escapeIlikePattern(value: string): string {
  return value.replace(/[\\_%]/g, (m) => `\\${m}`);
}

export type FetchPublicProductsOpts = {
  /** F-049 : curseur de pagination (created_at ISO du dernier item retourné). */
  cursor?: string | null;
  /** F-049 : taille de page (default 60, max 100). */
  limit?: number;
};

export type FetchPublicProductsResult = {
  products: PublicProductRow[];
  resolved: ResolvedFilters;
  /** F-049 : null si on a atteint la fin (page partielle), sinon created_at du dernier item. */
  nextCursor: string | null;
};

export async function fetchPublicProducts(
  supabase: SupabaseClient,
  filters: ProductsFilters,
  opts: FetchPublicProductsOpts = {},
): Promise<FetchPublicProductsResult> {
  const limit = Math.min(
    Math.max(1, opts.limit ?? PRODUCTS_PAGE_LIMIT_DEFAULT),
    PRODUCTS_PAGE_LIMIT_MAX,
  );

  const resolved: ResolvedFilters = {
    category: null,
    animal: null,
    cut: null,
  };

  // F-051 (audit pré-launch 2026-05) : résolutions slug en parallèle via
  // Promise.all. Avant : 3× await séquentiels (~100ms chacun → 300ms cumulés).
  // Après : ~100ms unique (limité par le slug le plus lent). Les 3 calls
  // sont indépendants et idempotents (read-only sur tables référentiels).
  const [catRef, animalRef, cutRef] = await Promise.all([
    filters.category
      ? resolveSlugToReference(supabase, 'product_categories', filters.category)
      : Promise.resolve(null),
    filters.animal
      ? resolveSlugToReference(supabase, 'animals', filters.animal)
      : Promise.resolve(null),
    filters.cut
      ? resolveSlugToReference(supabase, 'cuts', filters.cut)
      : Promise.resolve(null),
  ]);

  // Décision Q3 préservée : un slug fourni mais non résolu en DB → résultats
  // vides gracieux (pas d'exception, pas de 404).
  if (filters.category) {
    if (!catRef) return { products: [], resolved, nextCursor: null };
    resolved.category = { slug: filters.category, id: catRef.id, name: catRef.name };
  }
  if (filters.animal) {
    if (!animalRef) return { products: [], resolved, nextCursor: null };
    resolved.animal = { slug: filters.animal, id: animalRef.id, name: animalRef.name };
  }
  if (filters.cut) {
    if (!cutRef) return { products: [], resolved, nextCursor: null };
    resolved.cut = { slug: filters.cut, id: cutRef.id, name: cutRef.name };
  }

  // PostgREST permet de filtrer sur un champ d'un embed sans l'avoir
  // sélectionné (`.eq('producers.statut', 'public')` n'exige pas que
  // `statut` soit dans le select — comportement documenté Supabase JS).
  // On évite ainsi de transférer un champ inutile sur chaque row.
  let query = supabase
    .from('products')
    .select(
      `id, nom, prix, unite, photos, stock_disponible, stock_illimite, created_at,
       category_id, animal_id, cut_id,
       product_categories(slug, name),
       animals(slug, name),
       cuts(slug, name),
       producers!inner(slug, nom_exploitation)`,
    )
    .eq('active', true)
    .eq('producers.statut', 'public')
    .order('created_at', { ascending: false })
    .limit(limit);

  // F-049 : cursor pagination par created_at. Le filtre `lt` garantit
  // strict-less-than → pas de doublon entre pages successives quand
  // l'ordre est strictement décroissant. Collision possible si 2 produits
  // partagent exactement le même `created_at` à la microseconde : sur le
  // volume cible (16 prod, 100 horizon), risque négligeable, mais on
  // accepte le trade-off (cursor secondaire par id ne change pas la
  // sémantique pour ce volume).
  if (opts.cursor) {
    query = query.lt('created_at', opts.cursor);
  }

  if (filters.q) query = query.ilike('nom', `%${escapeIlikePattern(filters.q)}%`);
  if (resolved.category) query = query.eq('category_id', resolved.category.id);
  if (resolved.animal) query = query.eq('animal_id', resolved.animal.id);
  if (resolved.cut) query = query.eq('cut_id', resolved.cut.id);

  const { data, error } = await query;
  if (error) throw error;
  // Cast `as unknown as PublicProductRow[]` nécessaire : Supabase infère
  // les embeds (`product_categories(slug, name)` etc.) en `Array<...>`
  // alors que le runtime PostgREST retourne un objet (FK to-one) ou null.
  // Les types générés (lib/types/database.types.ts) n'ont pas l'info FK
  // is-one-to-one suffisante pour inférer correctement. Workaround
  // documenté côté communauté Supabase.
  const products = (data ?? []) as unknown as PublicProductRow[];

  // F-049 : nextCursor = created_at du dernier item si page pleine, sinon
  // null (fin de pagination atteinte).
  const nextCursor =
    products.length === limit ? products[products.length - 1].created_at : null;

  return { products, resolved, nextCursor };
}
