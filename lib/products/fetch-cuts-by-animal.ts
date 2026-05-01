import type { SupabaseClient } from '@supabase/supabase-js';
import type { Cut } from './types';

// Fetch des cuts d'un animal donné par slug (T-220 PR-C C2).
//
// Pattern : 1 RTT pour résoudre slug → id, 1 RTT pour fetcher les cuts
// de cet animal_id. Si l'animal n'existe pas (slug invalide), retourne []
// (cohérent avec le pattern de fetchPublicProducts en C1).
//
// Tri : sort_order puis name pour déterminisme (cf. helpers C1).

export async function fetchCutsByAnimalSlug(
  supabase: SupabaseClient,
  animalSlug: string,
): Promise<Cut[]> {
  const { data: animal } = await supabase
    .from('animals')
    .select('id')
    .eq('slug', animalSlug)
    .maybeSingle();

  const animalId = (animal as { id: string } | null)?.id;
  if (!animalId) return [];

  const { data, error } = await supabase
    .from('cuts')
    .select('id, animal_id, slug, name, sort_order')
    .eq('animal_id', animalId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) throw error;
  return (data ?? []) as Cut[];
}
