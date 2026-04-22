"use server";

// Phase 7 Stripe Customer — server action pour lister les PaymentMethods
// du user courant au moment du checkout. Si l'user a ≥1 CB enregistrée,
// la page checkout propose un sélecteur "Carte enregistrée" / "Nouvelle
// carte" au lieu de forcer une saisie via PaymentElement.

import type Stripe from "stripe";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe/server";

export type PaymentMethodSummary = {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
};

type ActionResult =
  | { pms: PaymentMethodSummary[] }
  | { error: string };

export async function listPaymentMethodsAction(): Promise<ActionResult> {
  const session = await getSessionUser();
  if (!session) return { error: "Non authentifié" };

  try {
    const admin = createSupabaseAdminClient();
    const { data: userRow } = await admin
      .from("users")
      .select("stripe_customer_id")
      .eq("id", session.id)
      .maybeSingle();

    const customerId = userRow?.stripe_customer_id as
      | string
      | null
      | undefined;

    // Pas de Customer Stripe → jamais payé ni ajouté de CB → liste vide.
    if (!customerId) return { pms: [] };

    const [customerResponse, list] = await Promise.all([
      stripe.customers.retrieve(customerId),
      stripe.paymentMethods.list({
        customer: customerId,
        type: "card",
        limit: 10,
      }),
    ]);

    let defaultId: string | null = null;
    if (!("deleted" in customerResponse) || !customerResponse.deleted) {
      const customer = customerResponse as Stripe.Customer;
      const raw = customer.invoice_settings?.default_payment_method;
      defaultId = typeof raw === "string" ? raw : (raw?.id ?? null);
    }

    const pms: PaymentMethodSummary[] = list.data
      .filter(
        (pm): pm is Stripe.PaymentMethod & { card: Stripe.PaymentMethod.Card } =>
          Boolean(pm.card),
      )
      .map((pm) => ({
        id: pm.id,
        brand: pm.card.brand,
        last4: pm.card.last4,
        expMonth: pm.card.exp_month,
        expYear: pm.card.exp_year,
        isDefault: pm.id === defaultId,
      }));

    return { pms };
  } catch (err) {
    console.error(
      `LIST_PM_ERROR user_id=${session.id} error=${(err as Error).message}`,
    );
    return { error: "Erreur lors du chargement des cartes enregistrées." };
  }
}
