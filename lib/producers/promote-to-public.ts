import type { SupabaseClient } from '@supabase/supabase-js';
import { revalidatePublicStats } from '@/lib/stats/revalidate';

// Auto-transition 'active' → 'public' au premier produit actif publié, MAIS
// sous condition que le producer remplisse les 3 critères "marketplace-ready"
// (Phase 3 du chantier "Vision funnel producteur") :
//
//   1. ≥ 1 produit `active = true`           — catalogue non vide
//   2. producers.stripe_charges_enabled = true — peut recevoir des paiements
//   3. ≥ 1 slot `active = true AND excluded_at IS NULL` — peut livrer
//
// Avant ce garde-fou, un producer pouvait apparaître sur /producteurs et la
// carte avec un Stripe Connect inachevé ou aucun créneau, laissant le
// consumer cliquer sur une fiche impossible à commander. Désormais le helper
// fail-open silencieusement (no-op + warn) si une condition manque.
//
// La garde finale `.eq('statut', 'active')` rend l'UPDATE idempotent :
// no-op si le producer est déjà 'public', 'pending', 'draft' ou 'suspended'.
// Ce helper ne fait JAMAIS l'inverse (public → active si condition perdue) :
// la dépublication automatique reste hors-scope (cf actions admin
// suspendProducer / reactivateProducer pour les transitions manuelles).
//
// Fail-open volontaire à chaque étape : si un check échoue (RLS, réseau…)
// on log via console.warn (préfixe PROMOTE_PRODUCER_WARN, grepable Vercel)
// sans bloquer la mutation appelante (création/edit produit).
//
// Le `.select('id')` final retourne les rows modifiées : on n'invalide le
// cache 'public-stats' QUE si une vraie promotion 'active' → 'public' a eu
// lieu. Sinon on évite un round-trip inutile à chaque save de produit d'un
// producer déjà public.
export async function promoteProducerToPublicIfActive(
  supabase: SupabaseClient,
  producerId: string,
): Promise<void> {
  // Pré-check 1 : statut + Stripe charges_enabled (un seul round-trip).
  const { data: producer, error: producerError } = await supabase
    .from('producers')
    .select('statut, stripe_charges_enabled')
    .eq('id', producerId)
    .maybeSingle();
  if (producerError) {
    console.warn('PROMOTE_PRODUCER_WARN [producers pre-check]', producerError);
    return;
  }
  if (!producer) return;
  if (producer.statut !== 'active') return;
  if (producer.stripe_charges_enabled !== true) return;

  // Pré-check 2 : ≥ 1 produit actif. `head: true` évite de payloader les rows
  // — on ne consomme que le compteur HTTP renvoyé par PostgREST.
  const { count: productCount, error: productError } = await supabase
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('producer_id', producerId)
    .eq('active', true);
  if (productError) {
    console.warn('PROMOTE_PRODUCER_WARN [products pre-check]', productError);
    return;
  }
  if ((productCount ?? 0) < 1) return;

  // Pré-check 3 : ≥ 1 créneau actif et non-exclu. Symétrique au filter
  // consumer (RPC create_order_with_items + page produit) qui exige
  // `active = true AND excluded_at IS NULL` pour qu'un slot soit réservable.
  const { count: slotCount, error: slotError } = await supabase
    .from('slots')
    .select('id', { count: 'exact', head: true })
    .eq('producer_id', producerId)
    .eq('active', true)
    .is('excluded_at', null);
  if (slotError) {
    console.warn('PROMOTE_PRODUCER_WARN [slots pre-check]', slotError);
    return;
  }
  if ((slotCount ?? 0) < 1) return;

  // Toutes les conditions OK : auto-promote 'active' → 'public'.
  const { data, error } = await supabase
    .from('producers')
    .update({ statut: 'public' })
    .eq('id', producerId)
    .eq('statut', 'active')
    .select('id');
  if (error) {
    console.warn('PROMOTE_PRODUCER_WARN [promoteProducerToPublicIfActive]', error);
    return;
  }
  if (Array.isArray(data) && data.length > 0) {
    await revalidatePublicStats({
      source: 'producer-promote-to-public',
      extra: { producerId },
    });
  }
}
