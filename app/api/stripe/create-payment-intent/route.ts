import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe/server";
import { getOrCreateStripeCustomer } from "@/lib/stripe/customer";

const bodySchema = z.object({
  order_id: z.string().uuid(),
  save_card: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.email) {
    return NextResponse.json({ error: "Email manquant" }, { status: 500 });
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();

  // L'accès passe par le client utilisateur (RLS): seul le consumer_id de
  // la commande peut lire sa propre commande.
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select(
      "id, consumer_id, producer_id, montant_total, statut, stripe_payment_intent_id",
    )
    .eq("id", parsed.data.order_id)
    .maybeSingle();

  if (orderError || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.consumer_id !== session.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // T-406 : la route prépare le paiement initial uniquement. Toute commande
  // hors `pending` (confirmed/ready/completed/cancelled/refunded) ne doit pas
  // pouvoir (re)passer ici — bloque aussi le path `update setup_future_usage`
  // ci-dessous sur un PI orphelin d'une commande terminée.
  if (order.statut !== "pending") {
    return NextResponse.json(
      { error: "Order not in pending state" },
      { status: 409 },
    );
  }

  // Stripe Customer (Phase 6) : toujours attaché au PI, même si save_card=false.
  // Préparation pour Phase 7 (sélecteur CB enregistrée au checkout) et pour
  // cohérence de l'historique Stripe côté customer.
  const admin = createSupabaseAdminClient();
  const { data: profile } = await admin
    .from("users")
    .select("prenom, nom")
    .eq("id", session.id)
    .maybeSingle();

  let customerId: string;
  try {
    customerId = await getOrCreateStripeCustomer(
      session.id,
      session.email,
      profile?.prenom as string | null | undefined,
      profile?.nom as string | null | undefined,
    );
  } catch (err) {
    return NextResponse.json(
      { error: `Stripe customer error: ${(err as Error).message}` },
      { status: 500 },
    );
  }

  const setupFutureUsage: "off_session" | undefined = parsed.data.save_card
    ? "off_session"
    : undefined;

  // Idempotence : si un PI existe déjà, on ajuste setup_future_usage + customer
  // pour refléter le choix courant (l'user a pu cocher/décocher la checkbox
  // entre 2 clics "Payer") et on renvoie le même client_secret (stable pour
  // la durée de vie du PI).
  if (order.stripe_payment_intent_id) {
    const existing = await stripe.paymentIntents.retrieve(
      order.stripe_payment_intent_id,
    );

    const currentSFU = existing.setup_future_usage ?? null;
    const targetSFU = setupFutureUsage ?? null;
    const customerMismatch = existing.customer !== customerId;

    if (currentSFU !== targetSFU || customerMismatch) {
      // Stripe accepte "" pour unset setup_future_usage. Le cast est requis
      // car le type TS ne liste que les valeurs enum + undefined, pas "".
      await stripe.paymentIntents.update(order.stripe_payment_intent_id, {
        customer: customerId,
        setup_future_usage: (setupFutureUsage ?? "") as "off_session",
      });
    }

    return NextResponse.json({ client_secret: existing.client_secret });
  }

  // Separate charges & transfers: le paiement arrive en totalité sur le
  // compte plateforme TerrOir. Le virement net vers le producteur
  // (montant_total − 6%) est déclenché plus tard par /api/cron/weekly-payout.
  const amount = Math.round(Number(order.montant_total) * 100);

  // payment_method_types: ["card"] explicite → désactive le default
  // automatic_payment_methods qui activerait Link dans le Payment Element.
  // Notre propre système de cartes sauvegardées (Stripe Customer) couvre
  // le besoin sans la friction Link (email+téléphone+nom obligatoires).
  // T-404 idempotencyKey : `pi_create_${order.id}` (UUID stable). Empeche
  // la double creation Stripe sur retry (timeout reseau, double-clic client,
  // re-render React). Cohérent avec le pattern `refund_${order_id}_*` des
  // 3 paths refund (T-408) + retry-failed-refund.ts.
  const pi = await stripe.paymentIntents.create(
    {
      amount,
      currency: "eur",
      customer: customerId,
      payment_method_types: ["card"],
      ...(setupFutureUsage && { setup_future_usage: setupFutureUsage }),
      metadata: {
        order_id: order.id,
        producer_id: order.producer_id,
        consumer_id: order.consumer_id ?? "",
      },
    },
    { idempotencyKey: `pi_create_${order.id}` },
  );

  const { error: updateError } = await supabase
    .from("orders")
    .update({ stripe_payment_intent_id: pi.id })
    .eq("id", order.id);

  if (updateError) {
    return NextResponse.json(
      { error: `Payment intent created but not persisted: ${updateError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ client_secret: pi.client_secret });
}
