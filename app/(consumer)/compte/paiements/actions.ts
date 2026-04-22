"use server";

// =============================================================================
// Server actions — gestion des moyens de paiement enregistrés (Phase 4)
// =============================================================================
// 3 actions exportées :
//   - createSetupIntentAction() : crée le Stripe Customer (lazy) et un
//     SetupIntent, retourne le client_secret pour que le client Elements
//     puisse confirmer la collecte d'une CB.
//   - setDefaultPaymentMethodAction(pmId) : met à jour
//     invoice_settings.default_payment_method côté Stripe.
//   - detachPaymentMethodAction(pmId) : detach la CB. Si c'était la default
//     ET qu'il en reste d'autres → bascule auto sur la 1ère restante.
//
// Ownership guard sur setDefault/detach : retrieve le PaymentMethod et
// compare son customer à users.stripe_customer_id du session user. Bloque
// toute manipulation d'une CB qui n'appartient pas au caller.
// =============================================================================

import type Stripe from "stripe";
import { revalidatePath } from "next/cache";
import { stripe } from "@/lib/stripe/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/session";
import { getOrCreateStripeCustomer } from "@/lib/stripe/customer";

async function getStripeCustomerId(userId: string): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("users")
    .select("stripe_customer_id")
    .eq("id", userId)
    .maybeSingle();
  return (data?.stripe_customer_id as string | null | undefined) ?? null;
}

export async function createSetupIntentAction(): Promise<
  { clientSecret: string } | { error: string }
> {
  const session = await getSessionUser();
  if (!session || !session.email) {
    return { error: "Non authentifié" };
  }

  try {
    const admin = createSupabaseAdminClient();
    const { data: profile } = await admin
      .from("users")
      .select("prenom, nom")
      .eq("id", session.id)
      .maybeSingle();

    const customerId = await getOrCreateStripeCustomer(
      session.id,
      session.email,
      profile?.prenom as string | null | undefined,
      profile?.nom as string | null | undefined,
    );

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ["card"],
      usage: "off_session",
    });

    if (!setupIntent.client_secret) {
      return { error: "Impossible de préparer l'ajout de carte." };
    }

    return { clientSecret: setupIntent.client_secret };
  } catch (err) {
    console.error(
      `SETUP_INTENT_ERROR user_id=${session.id} error=${(err as Error).message}`,
    );
    return { error: "Erreur lors de la préparation. Réessayez." };
  }
}

export async function setDefaultPaymentMethodAction(
  paymentMethodId: string,
): Promise<{ success: true } | { error: string }> {
  const session = await getSessionUser();
  if (!session) return { error: "Non authentifié" };

  try {
    const customerId = await getStripeCustomerId(session.id);
    if (!customerId) return { error: "Aucun compte Stripe associé." };

    // Ownership guard
    const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
    if (pm.customer !== customerId) {
      return { error: "Carte introuvable." };
    }

    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    revalidatePath("/compte/paiements");
    return { success: true };
  } catch (err) {
    console.error(
      `SET_DEFAULT_PM_ERROR user_id=${session.id} pm=${paymentMethodId} error=${(err as Error).message}`,
    );
    return { error: "Erreur lors de la mise à jour." };
  }
}

export async function detachPaymentMethodAction(
  paymentMethodId: string,
): Promise<
  { success: true; defaultChanged: boolean } | { error: string }
> {
  const session = await getSessionUser();
  if (!session) return { error: "Non authentifié" };

  try {
    const customerId = await getStripeCustomerId(session.id);
    if (!customerId) return { error: "Aucun compte Stripe associé." };

    // Ownership guard
    const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
    if (pm.customer !== customerId) {
      return { error: "Carte introuvable." };
    }

    // Fetch current default + remaining list AVANT detach
    const customerResponse = await stripe.customers.retrieve(customerId);
    if ("deleted" in customerResponse && customerResponse.deleted) {
      return { error: "Compte Stripe introuvable." };
    }
    const customer = customerResponse as Stripe.Customer;
    const currentDefaultRaw = customer.invoice_settings?.default_payment_method;
    const currentDefaultId =
      typeof currentDefaultRaw === "string"
        ? currentDefaultRaw
        : currentDefaultRaw?.id ?? null;
    const wasDefault = currentDefaultId === paymentMethodId;

    let defaultChanged = false;
    if (wasDefault) {
      const list = await stripe.paymentMethods.list({
        customer: customerId,
        type: "card",
      });
      const nextDefault = list.data.find((p) => p.id !== paymentMethodId);
      if (nextDefault) {
        await stripe.customers.update(customerId, {
          invoice_settings: { default_payment_method: nextDefault.id },
        });
        defaultChanged = true;
      }
    }

    await stripe.paymentMethods.detach(paymentMethodId);

    revalidatePath("/compte/paiements");
    return { success: true, defaultChanged };
  } catch (err) {
    console.error(
      `DETACH_PM_ERROR user_id=${session.id} pm=${paymentMethodId} error=${(err as Error).message}`,
    );
    return { error: "Erreur lors de la suppression." };
  }
}
