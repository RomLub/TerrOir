import "server-only";
import { stripe } from "./server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Récupère ou crée un Stripe Customer pour l'user donné. Idempotent : si
// users.stripe_customer_id existe déjà, le retourne sans rien créer.
//
// T-432 anti-race : 2 calls concurrents (2 tabs simultanés sur
// /compte/checkout + /compte/paiements) sont dédupliqués via
// idempotency-key Stripe SDK + UPDATE conditionnel atomique. Pattern aligné
// T-404 (pi_create_${order.id}) + T-405 (anti-race PI persist) éprouvés en
// prod Bundle 1 (#50).
//
// NE fail pas silencieusement : toute erreur (lecture DB, création Stripe,
// persistence) throw — l'appelant (create-payment-intent par ex.) doit
// propager le 500 au client plutôt que de continuer avec un customer manquant.
export async function getOrCreateStripeCustomer(
  userId: string,
  email: string,
  prenom?: string | null,
  nom?: string | null,
): Promise<string> {
  const admin = createSupabaseAdminClient();

  const { data: user, error: readError } = await admin
    .from("users")
    .select("stripe_customer_id")
    .eq("id", userId)
    .maybeSingle();

  if (readError) {
    throw new Error(`Failed to read user: ${readError.message}`);
  }

  const existing = user?.stripe_customer_id as string | null | undefined;
  if (existing) return existing;

  const name = [prenom, nom].filter(Boolean).join(" ").trim() || undefined;

  // T-432 idempotency-key Stripe SDK : 2 calls concurrents avec la même key
  // reçoivent le MÊME customer.id (dédup côté API Stripe, validity >24h pour
  // customers.create — couvre largement la fenêtre race typique de 100ms à
  // quelques secondes). Cohérent T-404 pi_create_${order.id}.
  const customer = await stripe.customers.create(
    {
      email,
      name,
      metadata: { user_id: userId },
    },
    { idempotencyKey: `customer_create_${userId}` },
  );

  // T-432 UPDATE conditionnel atomique : .is('stripe_customer_id', null) +
  // .select('id') détecte le cas où une requête concurrente a déjà persisté
  // le customer (qui est le MÊME que le nôtre grâce à l'idempotency-key).
  // 0 lignes touchées = race confirmée → re-SELECT pour récupérer le winner.
  // Cohérent T-405 (anti-race PI .is('stripe_payment_intent_id', null)).
  const { data: updatedRows, error: updateError } = await admin
    .from("users")
    .update({ stripe_customer_id: customer.id })
    .eq("id", userId)
    .is("stripe_customer_id", null)
    .select("id");

  if (updateError) {
    throw new Error(
      `Stripe customer created (${customer.id}) but not persisted: ${updateError.message}`,
    );
  }

  if (!updatedRows || updatedRows.length === 0) {
    // Race détectée : un autre call a déjà persisté son customer.id (qui
    // est le MÊME que customer.id grâce à l'idempotency-key Stripe). On
    // re-SELECT pour confirmer la cohérence et retourner le winner.
    const { data: refreshed, error: refreshError } = await admin
      .from("users")
      .select("stripe_customer_id")
      .eq("id", userId)
      .maybeSingle();

    if (refreshError) {
      throw new Error(
        `Customer race condition: re-SELECT failed: ${refreshError.message}`,
      );
    }

    const winningId = refreshed?.stripe_customer_id as
      | string
      | null
      | undefined;
    if (!winningId) {
      throw new Error(
        `Customer race condition unrecoverable: UPDATE 0 rows + re-SELECT null for user ${userId}`,
      );
    }

    return winningId;
  }

  return customer.id;
}
