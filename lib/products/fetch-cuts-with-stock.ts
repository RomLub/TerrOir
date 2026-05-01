import type { SupabaseClient } from '@supabase/supabase-js';

// Retourne le Set des slugs de cuts ayant au moins UN produit actif chez
// un producer public (T-220 PR-C). Consommé par /morceaux/boeuf pour
// griser les zones sans stock (cf. décision Q6 : opacité réduite +
// cursor not-allowed + tooltip natif).
//
// Pattern : query products avec inner joins cuts (pour récupérer le slug)
// + producers (pour appliquer le filtre statut='public' bypass-RLS).
// On déduplique côté client via Set parce que PostgREST n'expose pas
// DISTINCT facilement et la volumétrie reste petite (16 produits prod).
//
// Si volumétrie explose plus tard (>1000 produits), migrer vers une view
// matérialisée `cuts_with_stock` ou une RPC dédiée.

export async function fetchCutsWithStock(
  supabase: SupabaseClient,
): Promise<Set<string>> {
  // PostgREST permet de filtrer sur producers.statut sans le sélectionner
  // (cf. fetchPublicProducts pour la note détaillée). On garde un seul
  // champ minimal `id` dans l'embed pour matérialiser le inner join.
  const { data, error } = await supabase
    .from('products')
    .select(
      `cuts!inner(slug),
       producers!inner(id)`,
    )
    .eq('active', true)
    .eq('producers.statut', 'public');
  if (error) throw error;

  const slugs = new Set<string>();
  const rows = (data ?? []) as unknown as Array<{
    cuts: { slug: string } | null;
  }>;
  for (const row of rows) {
    if (row.cuts?.slug) slugs.add(row.cuts.slug);
  }
  return slugs;
}
