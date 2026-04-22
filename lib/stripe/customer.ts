import "server-only";
import { stripe } from "./server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Récupère ou crée un Stripe Customer pour l'user donné. Idempotent : si
// users.stripe_customer_id existe déjà, le retourne sans rien créer.
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

  const customer = await stripe.customers.create({
    email,
    name,
    metadata: { user_id: userId },
  });

  const { error: updateError } = await admin
    .from("users")
    .update({ stripe_customer_id: customer.id })
    .eq("id", userId);

  if (updateError) {
    // Race rare : customer créé côté Stripe mais pas persisté DB. Un prochain
    // appel recréera un customer orphelin — à nettoyer manuellement. On throw
    // pour signaler l'incohérence à l'appelant.
    throw new Error(
      `Stripe customer created (${customer.id}) but not persisted: ${updateError.message}`,
    );
  }

  return customer.id;
}
