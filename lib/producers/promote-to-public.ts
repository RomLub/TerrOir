import type { SupabaseClient } from '@supabase/supabase-js';
import { revalidatePublicStats } from '@/lib/stats/revalidate';

// Auto-transition 'active' → 'public' au premier produit actif publié
// (Chantier 2 Phase 6). La garde `.eq('statut', 'active')` rend l'update
// idempotent : no-op si le producer est déjà 'public', 'pending', 'draft'
// ou 'suspended'. Fail-open : si l'update échoue (RLS, réseau…), on log
// sans bloquer la publication du produit en cours.
//
// Le `.select('id')` retourne les rows réellement modifiées : on n'invalide
// le cache 'public-stats' QUE si une vraie promotion 'active' → 'public' a
// eu lieu. Sinon (no-op idempotent) on évite un round-trip de revalidation
// inutile à chaque save de produit d'un producer déjà public.
export async function promoteProducerToPublicIfActive(
  supabase: SupabaseClient,
  producerId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('producers')
    .update({ statut: 'public' })
    .eq('id', producerId)
    .eq('statut', 'active')
    .select('id');
  if (error) {
    // Fail-open volontaire : échec de promotion ne doit pas casser la
    // création du produit. console.warn pour ne pas polluer les alertes
    // d'erreurs Vercel — grep "PROMOTE_PRODUCER_WARN" pour retrouver.
    console.warn('PROMOTE_PRODUCER_WARN [promoteProducerToPublicIfActive]', error);
    return;
  }
  if (Array.isArray(data) && data.length > 0) {
    await revalidatePublicStats();
  }
}
