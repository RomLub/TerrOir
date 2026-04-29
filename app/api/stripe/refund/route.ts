import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe/server";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";
import {
  InvalidOrderTransitionError,
  assertTransition,
  type OrderStatus,
} from "@/lib/orders/stateMachine";

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
    if (session?.isAdmin) {
      authorized = true;
    } else if (session?.roles.includes("producer")) {
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

  // Filet état machine AVANT le refund Stripe : refuser une transition
  // invalide ici évite d'émettre un refund Stripe irrécupérable. Refund
  // admin = action explicite ; pas de fallback cancelled comme la route
  // cancel.
  try {
    assertTransition(order.statut as OrderStatus, "refunded");
  } catch (e) {
    if (e instanceof InvalidOrderTransitionError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    throw e;
  }

  // Instrumentation T-107 : capture l'échec Stripe dans audit_logs avant
  // de propager le 500. Pré-requis pour qu'un cron retry futur (extension
  // T-102) puisse réconcilier les `order_admin_refund_failed` orphelins.
  let refund;
  try {
    refund = await stripe.refunds.create({
      payment_intent: order.stripe_payment_intent_id,
    });
  } catch (e) {
    await logPaymentEvent({
      eventType: "order_admin_refund_failed",
      userId: order.consumer_id,
      metadata: {
        order_id: order.id,
        payment_intent_id: order.stripe_payment_intent_id,
        refund_error: (e as Error).message,
      },
    });
    throw e;
  }

  const { error: updateError } = await admin
    .from("orders")
    .update({
      statut: "refunded",
      cancellation_reason: "admin_refund",
      cancelled_at: new Date().toISOString(),
    })
    .eq("id", order.id);

  if (updateError) {
    // Drift Stripe/DB : refund émis chez Stripe mais statut DB non mis à
    // jour. Préfixe grep-able pour réconciliation manuelle en prod.
    return NextResponse.json(
      {
        refund_id: refund.id,
        warning: `[REFUND_DB_DRIFT] order=${order.id} refund_id=${refund.id} ${updateError.message}`,
      },
      { status: 500 },
    );
  }

  // Refunded sort le filtre IN ('confirmed','ready','completed') du cache
  // public-stats → invalidation requise. Try/catch : un cache flapping ne
  // doit pas faire échouer le 200 vers l'admin.
  try {
    revalidateTag("public-stats");
  } catch (e) {
    console.warn(`[STATS_REVAL_WARN] order=${order.id} ${(e as Error).message}`);
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
