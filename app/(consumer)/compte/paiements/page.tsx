import { Suspense } from "react";
import type Stripe from "stripe";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe/server";
import { SectionSkeleton } from "../_components/ContentSkeletons";
import PaymentMethodsList, {
  type PaymentMethodSummary,
} from "./_components/PaymentMethodsList";

// Server component : fetch initial de l'état Stripe pour l'user courant.
// Création Customer lazy : la page ne crée jamais de Customer à l'affichage,
// uniquement au 1er "Ajouter une carte" (createSetupIntentAction → getOrCreate).
// Donc un user qui n'a jamais payé ni ajouté de carte n'a pas de customer_id
// en base et voit l'état vide.
// Coquille synchrone : l'en-tête s'affiche immédiatement (post-garde), la
// liste des moyens de paiement (lookup Supabase + appels Stripe) est streamée
// via <Suspense> — c'est le fetch le plus lent de la zone /compte.
export default async function PaiementsPage() {
  const session = await getSessionUser();
  if (!session) redirect("/connexion");

  return (
    <main className="mx-auto max-w-2xl">
      <header className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-terroir-terra-700">
          Mon compte
        </p>
        <h1 className="mt-2 font-serif text-[40px] leading-tight text-terroir-green-700">
          Moyens de paiement
        </h1>
        <p className="mt-2 text-sm text-terroir-muted">
          Enregistre une carte pour faciliter tes prochaines commandes.
        </p>
      </header>

      <Suspense fallback={<SectionSkeleton rows={2} />}>
        <PaiementsContent userId={session.id} />
      </Suspense>
    </main>
  );
}

async function PaiementsContent({ userId }: { userId: string }) {
  const admin = createSupabaseAdminClient();
  const { data: userRow } = await admin
    .from("users")
    .select("stripe_customer_id")
    .eq("id", userId)
    .maybeSingle();

  const stripeCustomerId =
    (userRow?.stripe_customer_id as string | null | undefined) ?? null;

  let methods: PaymentMethodSummary[] = [];

  if (stripeCustomerId) {
    try {
      const [customerResponse, list] = await Promise.all([
        stripe.customers.retrieve(stripeCustomerId),
        stripe.paymentMethods.list({
          customer: stripeCustomerId,
          type: "card",
        }),
      ]);

      let defaultId: string | null = null;
      if (!("deleted" in customerResponse) || !customerResponse.deleted) {
        const customer = customerResponse as Stripe.Customer;
        const raw = customer.invoice_settings?.default_payment_method;
        defaultId = typeof raw === "string" ? raw : (raw?.id ?? null);
      }

      methods = list.data
        .filter((pm): pm is Stripe.PaymentMethod & { card: Stripe.PaymentMethod.Card } =>
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
    } catch (err) {
      console.error(
        `PAIEMENTS_PAGE_FETCH_ERROR user_id=${userId} customer_id=${stripeCustomerId} error=${(err as Error).message}`,
      );
    }
  }

  return <PaymentMethodsList initialMethods={methods} />;
}
