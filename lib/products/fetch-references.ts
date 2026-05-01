import type { SupabaseClient } from '@supabase/supabase-js';
import type { Animal, Cut, ProductCategory } from './types';

// Fetchers des 3 référentiels catégorisation produit (T-220 PR-B).
//
// Appelés au mount des pages /catalogue/nouveau et /catalogue/[id]/modifier.
// RLS read public sur les 3 tables (migration PR-A) → pas besoin de session.
//
// Volume actuel : 7 + 6 + 30 rows. Fetch en bulk sans pagination, le total
// reste largement sous le plafond raisonnable d'un select front-end même
// après extension à d'autres animaux (estimé ~150 cuts max long terme).
//
// Tri : `ORDER BY sort_order, name` — déterministe même si deux rows
// partagent le même `sort_order` (cas non utilisé aujourd'hui mais
// résilient). Le `sort_order` reflète l'ordre métier (viande en 1er,
// boeuf en 1er, joue→queue→colis-mixte côté cuts).
//
// Le client Supabase est passé en argument pour découpler du
// `createSupabaseBrowserClient()` factory et faciliter le test en isolation.

export async function fetchProductCategories(
  supabase: SupabaseClient,
): Promise<ProductCategory[]> {
  const { data, error } = await supabase
    .from('product_categories')
    .select('id, slug, name, sort_order')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ProductCategory[];
}

export async function fetchAnimals(
  supabase: SupabaseClient,
): Promise<Animal[]> {
  const { data, error } = await supabase
    .from('animals')
    .select('id, slug, name, sort_order')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Animal[];
}

export async function fetchCuts(
  supabase: SupabaseClient,
): Promise<Cut[]> {
  const { data, error } = await supabase
    .from('cuts')
    .select('id, animal_id, slug, name, sort_order')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Cut[];
}
