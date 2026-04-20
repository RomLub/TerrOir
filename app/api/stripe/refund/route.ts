import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe/server";

const bodySchema = z.object({ order_id: z.string().uuid() });

// Auth: admin, producteur propriétaire de la commande, ou appel interne
// (timeout 24h) via header X-Cron-Secret.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  const { data: order } = await admin
    .from("orders")
    .select(
      "id, consumer_id, producer_id, statut, stripe_payment_intent_id, montant_total, code_commande",
    )
    .eq("id", parsed.data.order_id)
    .maybeSingle();

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const cronSecret = process.env.CRON_SECRET;
  const isSystemCall =
    cronSecret !== undefined &&
    request.headers.get("x-cron-secret") === cronSecret;

  let authorized = isSystemCall;

  if (!authorized) {
    const session = await getSessionUser();
    if (session?.role === "admin") {
      authorized = true;
    } else if (session?.role === "producer") {
      const { data: producer } = await admin
        .from("producers")
        .select("id")
        .eq("user_id", session.id)
        .maybeSingle();
      if (producer?.id === order.producer_id) authorized = true;
    }
  }

  if (!authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (order.statut === "refunded") {
    return NextResponse.json({ ok: true, already: true });
  }
  if (!order.stripe_payment_intent_id) {
    return NextResponse.json(
      { error: "No payment intent to refund" },
      { status: 409 },
    );
  }

  const refund = await stripe.refunds.create({
    payment_intent: order.stripe_payment_intent_id,
  });

  const { error: updateError } = await admin
    .from("orders")
    .update({
      statut: "refunded",
      cancelled_at: new Date().toISOString(),
    })
    .eq("id", order.id);

  if (updateError) {
    return NextResponse.json(
      {
        refund_id: refund.id,
        warning: `Refund issued but order not updated: ${updateError.message}`,
      },
      { status: 500 },
    );
  }

  if (order.consumer_id) {
    await admin.from("notifications").insert({
      user_id: order.consumer_id,
      type: "email",
      template: "order_refunded",
      metadata: {
        order_id: order.id,
        code_commande: order.code_commande,
        refund_id: refund.id,
        amount: order.montant_total,
      },
    });
  }

  return NextResponse.json({ refund_id: refund.id });
}
