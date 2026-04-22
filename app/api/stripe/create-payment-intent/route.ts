import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/server";

const bodySchema = z.object({ order_id: z.string().uuid() });

export async function POST(request: Request) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
      "id, consumer_id, producer_id, montant_total, stripe_payment_intent_id",
    )
    .eq("id", parsed.data.order_id)
    .maybeSingle();

  if (orderError || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.consumer_id !== session.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Idempotence: si un PI existe déjà, on renvoie son client_secret.
  if (order.stripe_payment_intent_id) {
    const existing = await stripe.paymentIntents.retrieve(
      order.stripe_payment_intent_id,
    );
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
  const pi = await stripe.paymentIntents.create({
    amount,
    currency: "eur",
    payment_method_types: ["card"],
    metadata: {
      order_id: order.id,
      producer_id: order.producer_id,
      consumer_id: order.consumer_id ?? "",
    },
  });

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
