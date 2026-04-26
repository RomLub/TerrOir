import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

// Extrait du handler webhook `account.updated` (cf app/api/stripe/webhook/route.tsx).
// Sortie en module séparé pour pouvoir tester en isolation : le handler
// route.tsx reste un thin wrapper qui appelle cette fonction puis ack 200.
//
// Sémantique reproduite à l'identique du handler historique (commit `de4a2cd`) :
//   - Lit charges_enabled / payouts_enabled / details_submitted de l'objet
//     Stripe.Account (cast booléen défensif).
//   - UPDATE producers SET les 3 flags WHERE stripe_account_id = account.id.
//   - Producer orphelin (aucune row matchée) = cas normal côté Stripe (compte
//     Connect créé sans persistance DB, ou producer déjà RGPD-anonymisé) →
//     return { updated: false } sans throw, le caller ack 200 quand même.
//   - Erreur PostgREST = log warn préfixé grep-able sans throw (cohérent
//     avec le pattern fail-open du handler historique : Stripe ne retry pas
//     un 200 même si on a raté l'UPDATE — ce qui évite des storms à chaque
//     race condition transitoire et garde la signature reset par account.id
//     quand Stripe re-émet l'event).
//
// Différence subtile avec le handler historique : ajout de `.select('id')`
// pour matérialiser la liste des rows touchées (Prefer: return=representation
// côté PostgREST). Invisible côté Stripe, nécessaire pour distinguer
// updated=true vs updated=false (producer orphelin) côté tests + telemetry.
export async function syncStripeAccountFlags(
  account: Stripe.Account,
  admin: SupabaseClient,
): Promise<{ updated: boolean; producerId: string | null }> {
  const chargesEnabled = !!account.charges_enabled;
  const payoutsEnabled = !!account.payouts_enabled;
  const detailsSubmitted = !!account.details_submitted;

  console.log(
    `[STRIPE_ACCOUNT_UPDATED] account=${account.id} charges=${chargesEnabled} payouts=${payoutsEnabled} details=${detailsSubmitted}`,
  );

  const { data, error } = await admin
    .from("producers")
    .update({
      stripe_charges_enabled: chargesEnabled,
      stripe_payouts_enabled: payoutsEnabled,
      stripe_details_submitted: detailsSubmitted,
    })
    .eq("stripe_account_id", account.id)
    .select("id");

  if (error) {
    console.warn(
      `[STRIPE_ACCOUNT_UPDATED_ERR] account=${account.id} error=${(error as { message?: string }).message ?? "unknown"}`,
    );
    return { updated: false, producerId: null };
  }

  if (!Array.isArray(data) || data.length === 0) {
    return { updated: false, producerId: null };
  }

  return { updated: true, producerId: String((data[0] as { id: unknown }).id) };
}
