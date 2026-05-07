import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProductsFilters } from './parse-search-params';

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

export async function fetchPublicProducts(
  supabase: SupabaseClient,
  filters: ProductsFilters,
): Promise<{ products: PublicProductRow[]; resolved: ResolvedFilters }> {
  const resolved: ResolvedFilters = {
    category: null,
    animal: null,
    cut: null,
  };

  if (filters.category) {
    const ref = await resolveSlugToReference(supabase, 'product_categories', filters.category);
    if (!ref) return { products: [], resolved };
    resolved.category = { slug: filters.category, id: ref.id, name: ref.name };
  }
  if (filters.animal) {
    const ref = await resolveSlugToReference(supabase, 'animals', filters.animal);
    if (!ref) return { products: [], resolved };
    resolved.animal = { slug: filters.animal, id: ref.id, name: ref.name };
  }
  if (filters.cut) {
    const ref = await resolveSlugToReference(supabase, 'cuts', filters.cut);
    if (!ref) return { products: [], resolved };
    resolved.cut = { slug: filters.cut, id: ref.id, name: ref.name };
  }

  // PostgREST permet de filtrer sur un champ d'un embed sans l'avoir
  // sélectionné (`.eq('producers.statut', 'public')` n'exige pas que
  // `statut` soit dans le select — comportement documenté Supabase JS).
  // On évite ainsi de transférer un champ inutile sur chaque row.
  let query = supabase
    .from('products')
    .select(
      `id, nom, prix, unite, photos, stock_disponible, stock_illimite,
       category_id, animal_id, cut_id,
       product_categories(slug, name),
       animals(slug, name),
       cuts(slug, name),
       producers!inner(slug, nom_exploitation)`,
    )
    .eq('active', true)
    .eq('producers.statut', 'public')
    .order('created_at', { ascending: false });

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
  return {
    products: (data ?? []) as unknown as PublicProductRow[],
    resolved,
  };
}
