import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe/server";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";
import { classifyRefundError } from "@/lib/refund-incidents/classify-error";
import { recordRefundAttempt } from "@/lib/refund-incidents/record-refund-attempt";
import { revalidatePublicStats } from "@/lib/stats/revalidate";
import { sendTemplate } from "@/lib/resend/send";
import { SUPPORT_EMAIL } from "@/lib/env/support-email";
import AdminProducerRefundAlert, {
  subject as producerRefundAlertSubject,
} from "@/lib/resend/templates/admin-producer-refund-alert";
import {
  InvalidOrderTransitionError,
  assertTransition,
  type OrderStatus,
} from "@/lib/orders/stateMachine";
import {
  consumeRateLimit,
  getStripeRefundRateLimit,
} from "@/lib/rate-limit";
import { extractRequestContext } from "@/lib/audit-logs/log-auth-event";

const bodySchema = z.object({ order_id: z.string().uuid() });

// Audit Stripe L-5 (2026-05-05) : seuil au-delà duquel un refund producer
// déclenche un email admin. Default 100€, configurable via env. Sujet V1.x
// si abus observé : cap montant + approval admin avant émission.
function producerRefundThreshold(): number {
  const raw = process.env.SUPPORT_REFUND_THRESHOLD_EUR;
  if (!raw) return 100;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 100;
  return parsed;
}

// Auth: admin ou producteur propriétaire de la commande.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // Audit Stripe pré-launch W-2 : rate-limit applicatif (5/60s). Key user
  // si session, IP fallback sinon (un caller anonyme tombe en 403 plus bas
  // mais on freine quand même le flood). Logué [STRIPE_REFUND_RATE_LIMITED].
  const session = await getSessionUser();
  const rateLimitKey =
    session?.id ?? extractRequestContext(request.headers).ipAddress ?? "unknown";
  const rl = await consumeRateLimit(getStripeRefundRateLimit(), rateLimitKey);
  if (!rl.success) {
    const retryAfter = Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000));
    console.warn(
      `[STRIPE_REFUND_RATE_LIMITED] key=${rateLimitKey} cap=${rl.limit} retry_after=${retryAfter}`,
    );
    return NextResponse.json(
      { error: "rate_limited", retry_after: retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
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

  let authorized = false;
  let refundedByProducer = false;
  if (session?.isAdmin) {
    authorized = true;
  } else if (session?.roles.includes("producer")) {
    const { data: producer } = await admin
      .from("producers")
      .select("id")
      .eq("user_id", session.id)
      .maybeSingle();
    if (producer?.id === order.producer_id) {
      authorized = true;
      refundedByProducer = true;
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
  // T-408 idempotencyKey : `refund_${order.id}_admin` (context discriminator
  // distinct des paths manual_cancel / timeout / retry).
  let refund;
  try {
    refund = await stripe.refunds.create(
      { payment_intent: order.stripe_payment_intent_id },
      { idempotencyKey: `refund_${order.id}_admin` },
    );
  } catch (e) {
    // T-102.2.b — double écriture refund_incidents + audit_logs (helper
    // fail-safe : ne throw pas). On enregistre AVANT de propager le throw
    // pour que l'incident soit tracé même si le caller renvoie un 500.
    const classified = classifyRefundError(e);
    await recordRefundAttempt({
      orderId: order.id,
      kind: "admin",
      paymentIntentId: order.stripe_payment_intent_id,
      consumerId: order.consumer_id,
      blockedReason: null,
      outcome: "failed",
      classified,
    });
    // Audit Stripe L-5 : discrimination producer vs admin sur l'audit log.
    // refund_incidents reste sur kind='admin' (les paths cron retry sont
    // câblés dessus) — V1.x peut ajouter kind='producer' si retry distinct.
    await logPaymentEvent({
      eventType: refundedByProducer
        ? "order_producer_refund_failed"
        : "order_admin_refund_failed",
      userId: order.consumer_id,
      metadata: {
        order_id: order.id,
        producer_id: order.producer_id,
        payment_intent_id: order.stripe_payment_intent_id,
        refund_error: (e as Error).message,
        emitted_by: refundedByProducer ? "producer" : "admin",
      },
    });
    throw e;
  }

  const { error: updateError } = await admin
    .from("orders")
    .update({
      statut: "refunded",
      closure_reason: "admin_refund",
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
  // public-stats → invalidation requise. Le helper swallow toute exception
  // (cache flapping ne doit pas faire échouer le 200 vers l'admin).
  await revalidatePublicStats({ source: "stripe-refund", orderId: order.id });

  // Audit Stripe L-5 : event success discriminé producer/admin. Le path
  // historique restait silent au succès (uniquement audit log côté failure).
  // Maintenant : trace forensique systématique pour reconstitution chronologie
  // (RGPD + dispute Stripe + détection abus producer).
  await logPaymentEvent({
    eventType: refundedByProducer
      ? "order_producer_refund_succeeded"
      : "order_admin_refund_succeeded",
    userId: order.consumer_id,
    metadata: {
      order_id: order.id,
      producer_id: order.producer_id,
      payment_intent_id: order.stripe_payment_intent_id,
      refund_id: refund.id,
      amount: Number(order.montant_total),
      emitted_by: refundedByProducer ? "producer" : "admin",
    },
  }).catch(() => {});

  // Audit Stripe L-5 : email admin si producer + montant >= seuil.
  // Pas de cap, pas d'approval — uniquement signal de visibilité (cas
  // problématique : producer mal intentionné refund toutes ses commandes
  // pour fuir la commission TerrOir). Sujet V1.x si abus observé.
  if (refundedByProducer) {
    const threshold = producerRefundThreshold();
    const amount = Number(order.montant_total);
    if (Number.isFinite(amount) && amount >= threshold) {
      const props = {
        codeCommande: order.code_commande,
        amount,
        threshold,
        refundId: refund.id,
        orderId: order.id,
        producerId: order.producer_id,
        dashboardUrl: `https://dashboard.stripe.com/refunds/${refund.id}`,
      };
      waitUntil(
        sendTemplate({
          to: SUPPORT_EMAIL,
          userId: null,
          template: "admin_producer_refund_alert",
          subject: producerRefundAlertSubject(props),
          element: <AdminProducerRefundAlert {...props} />,
          metadata: {
            order_id: order.id,
            refund_id: refund.id,
            producer_id: order.producer_id,
          },
        }).catch((err) => {
          console.error(
            `[PRODUCER_REFUND_ALERT_EMAIL_ERR] order=${order.id} refund=${refund.id} error=${(err as Error).message}`,
          );
        }),
      );
    }
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
