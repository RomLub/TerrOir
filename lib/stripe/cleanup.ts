import "server-only";
import { stripe } from "./server";

// Supprime un compte Stripe Connect. Fail-open : ne throw JAMAIS.
// Les comptes avec activité (paiements, virements non réglés) ne sont pas
// toujours supprimables directement. Dans ce cas, l'appelant doit lever un
// flag (producers.stripe_cleanup_pending = true) pour un cleanup manuel
// depuis le back-office admin.
export async function deleteStripeConnectAccount(
  stripeAccountId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await stripe.accounts.del(stripeAccountId);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: (err as Error).message ?? "unknown",
    };
  }
}

// Supprime un Stripe Customer (côté consumer). Fail-open : ne throw JAMAIS.
// Contrairement aux Connect accounts, les customers sont en principe toujours
// deletables — stripe.customers.del détache automatiquement les PaymentMethods
// et anonymise les charges historiques. En cas d'échec (rare), l'appelant
// peut logger et continuer : la purge RGPD n'est pas bloquée par Stripe.
export async function deleteStripeCustomer(
  customerId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await stripe.customers.del(customerId);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: (err as Error).message ?? "unknown",
    };
  }
}
