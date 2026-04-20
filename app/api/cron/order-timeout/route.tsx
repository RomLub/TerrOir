import { NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/cron/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe/server";
import {
  assertTransition,
  type OrderStatus,
} from "@/lib/orders/stateMachine";
import { sendTemplate } from "@/lib/resend/send";
import OrderTimeoutCancelled, {
  subject as timeoutSubject,
} from "@/lib/resend/templates/order-timeout-cancelled";

// Toutes les heures : annule + rembourse les commandes pending depuis +24h.
export async function POST(request: Request) {
  const authError = assertCronAuth(request);
  if (authError) return authError;

  const admin = createSupabaseAdminClient();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: orders, error } = await admin
    .from("orders")
    .select(
      "id, code_commande, consumer_id, producer_id, montant_total, stripe_payment_intent_id",
    )
    .eq("statut", "pending")
    .lt("created_at", cutoff);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!orders || orders.length === 0) {
    return NextResponse.json({ processed: 0 });
  }

  const results: Array<{
    order_id: string;
    refunded: boolean;
    error?: string;
  }> = [];

  for (const order of orders) {
    let refundError: string | undefined;

    if (order.stripe_payment_intent_id) {
      try {
        await stripe.refunds.create({
          payment_intent: order.stripe_payment_intent_id,
        });
      } catch (e) {
        refundError = (e as Error).message;
      }
    }

    const nextStatus: OrderStatus =
      order.stripe_payment_intent_id && !refundError ? "refunded" : "cancelled";

    assertTransition("pending", nextStatus);

    await admin
      .from("orders")
      .update({
        statut: nextStatus,
        cancellation_reason: "timeout",
        cancelled_at: new Date().toISOString(),
      })
      .eq("id", order.id);

    // Producteur + email consommateur
    const { data: producer } = await admin
      .from("producers")
      .select("nom_exploitation")
      .eq("id", order.producer_id)
      .maybeSingle();
    const { data: consumer } = await admin
      .from("users")
      .select("email")
      .eq("id", order.consumer_id)
      .maybeSingle();

    if (consumer?.email && producer) {
      const props = {
        codeCommande: order.code_commande,
        exploitation: producer.nom_exploitation,
        amount: Number(order.montant_total),
      };
      await sendTemplate({
        to: consumer.email,
        userId: order.consumer_id,
        template: "order_timeout_cancelled",
        subject: timeoutSubject(props),
        element: <OrderTimeoutCancelled {...props} />,
        metadata: { order_id: order.id, code_commande: order.code_commande },
      });
    }

    results.push({
      order_id: order.id,
      refunded: !refundError && Boolean(order.stripe_payment_intent_id),
      error: refundError,
    });
  }

  return NextResponse.json({ processed: results.length, results });
}
