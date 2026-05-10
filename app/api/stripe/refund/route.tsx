import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe/server";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";
import { sendOpsAlert } from "@/lib/ops/alert";
import { classifyRefundError } from "@/lib/refund-incidents/classify-error";
import { recordRefundAttempt } from "@/lib/refund-incidents/record-refund-attempt";
import { revalidatePublicStats } from "@/lib/stats/revalidate";
import { sendTemplate } from "@/lib/resend/send";
import { SUPPORT_EMAIL } from "@/lib/env/support-email";
import AdminProducerRefundAlert, {
  subject as producerRefundAlertSubject,
} from "@/lib/resend/templates/admin-producer-refund-alert";
import AdminProducerRefundCapExceeded, {
  subject as producerRefundCapExceededSubject,
} from "@/lib/resend/templates/admin-producer-refund-cap-exceeded";
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
import { reverseTransferIfNeeded } from "@/lib/stripe/reverse-transfer";

const bodySchema = z.object({ order_id: z.string().guid() });

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

// F-014 (audit pré-launch 2026-05-10) : cap DUR au-delà duquel un refund
// producer est rejeté en 403 + alerte admin. Default 500€, configurable via
// PRODUCER_REFUND_CAP_EUR. Combiné avec F-004 clawback : protège contre un
// producer compromis qui drainerait la platform balance avant détection.
// Le seuil "soft" producerRefundThreshold (alerte email post-succès) reste
// indépendant — il signale les refunds en zone [threshold..cap] sans bloquer.
const PRODUCER_REFUND_CAP_EUR_DEFAULT = 500;
function producerRefundCap(): number {
  const raw = process.env.PRODUCER_REFUND_CAP_EUR;
  if (!raw) return PRODUCER_REFUND_CAP_EUR_DEFAULT;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return PRODUCER_REFUND_CAP_EUR_DEFAULT;
  }
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

  const { data: order, error: orderLookupErr } = await admin
    .from("orders")
    .select(
      "id, consumer_id, producer_id, statut, stripe_payment_intent_id, montant_total, code_commande",
    )
    .eq("id", parsed.data.order_id)
    .maybeSingle();

  if (orderLookupErr) {
    console.error(
      `[ORDER_LOOKUP_ERR] route=refund order_id=${parsed.data.order_id} error=${orderLookupErr.message}`,
    );
    return NextResponse.json({ error: "Internal database error" }, { status: 500 });
  }
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

  // F-014 : cap DUR producer self-refund. Bloque AVANT toute action Stripe.
  // L'admin n'est PAS soumis au cap (path historique, approval implicite par
  // le rôle admin lui-même). Le cap protège contre un producer compromis qui
  // drainerait la platform balance avant détection (cf. F-004 clawback).
  if (refundedByProducer) {
    const cap = producerRefundCap();
    const attempted = Number(order.montant_total);
    if (Number.isFinite(attempted) && attempted > cap) {
      console.warn(
        `[PRODUCER_REFUND_CAP_EXCEEDED] order=${order.id} producer=${order.producer_id} attempted=${attempted} cap=${cap}`,
      );
      await logPaymentEvent({
        eventType: "producer_refund_cap_exceeded",
        userId: order.consumer_id,
        metadata: {
          order_id: order.id,
          producer_id: order.producer_id,
          attempted_amount: attempted,
          cap,
        },
      }).catch(() => {});

      const props = {
        codeCommande: order.code_commande,
        attemptedAmount: attempted,
        cap,
        orderId: order.id,
        producerId: order.producer_id,
      };
      waitUntil(
        sendTemplate({
          to: SUPPORT_EMAIL,
          userId: null,
          template: "admin_producer_refund_cap_exceeded",
          subject: producerRefundCapExceededSubject(props),
          element: <AdminProducerRefundCapExceeded {...props} />,
          metadata: {
            order_id: order.id,
            producer_id: order.producer_id,
            attempted_amount: attempted,
            cap,
          },
        }).catch((err) => {
          console.error(
            `[PRODUCER_REFUND_CAP_EXCEEDED_EMAIL_ERR] order=${order.id} error=${(err as Error).message}`,
          );
        }),
      );

      return NextResponse.json(
        {
          error: "refund_cap_exceeded",
          attempted_amount: attempted,
          cap,
        },
        { status: 403 },
      );
    }
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

  // F-004 — Reversal AVANT refund (Option A, atomicité d'échec).
  // Doctrine : refund Stripe irrévocable + reversal faillible → si on émet
  // le refund d'abord et le reversal échoue ensuite, la perte platform est
  // garantie sans rollback possible. En appelant le helper d'abord :
  //   - noop_no_transfer_id (order pre-completion / pas encore payoutée) → continue refund
  //   - noop_lookup_failed (DB transitoire) → continue refund + log forensique
  //   - reversed → continue refund (clawback effectué)
  //   - failed → BLOQUE le refund (Connect vidé après payout banque, capabilities révoquées, etc.)
  //
  // Comportement kind='failed' sur ce path admin/producer :
  //   1. On bloque le refund pour ne pas créer de drift platform.
  //   2. L'admin investigue manuellement via Dashboard Stripe (Connect status,
  //      balance, capabilities) puis re-tente ou émet refund manuel + reversal.
  //   3. sendOpsAlert (Sentry + email ops) pour signal critique.
  // Refacto futur : si tu uniformises ce comportement, vérifie l'invariant
  // par caller dans le commit de référence F-004 sub-2.
  const reversal = await reverseTransferIfNeeded({
    admin,
    orderId: order.id,
    amountEur: Number(order.montant_total),
    source: refundedByProducer ? "refund_producer" : "refund_admin",
  });
  if (reversal.kind === "failed") {
    await sendOpsAlert(
      "[TRANSFER_REVERSAL_BLOCKED_REFUND]",
      new Error(reversal.error),
      {
        order_id: order.id,
        transfer_id: reversal.transferId,
        producer_id: order.producer_id,
        path: refundedByProducer ? "refund_producer" : "refund_admin",
        amount: Number(order.montant_total),
      },
    );
    return NextResponse.json(
      {
        error: "reversal_failed",
        transfer_id: reversal.transferId,
      },
      { status: 502 },
    );
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

  // F-001 P0-TA : transition * → refunded via RPC SECDEF cancel_order.
  // p_reason='admin_refund' ∈ skip-list audit RPC (l'audit `order_admin_*
  // _refund_succeeded` ci-dessous porte le contexte Stripe complet).
  // Drift Stripe/DB : refund émis chez Stripe mais RPC ratée → log
  // [REFUND_DB_DRIFT] grep-able + sendOpsAlert (alerte critique).
  const { error: rpcError } = await admin.rpc("cancel_order", {
    p_order_id: order.id,
    p_reason: "admin_refund",
    p_target_status: "refunded",
  });

  if (rpcError) {
    await sendOpsAlert("[REFUND_DB_DRIFT]", new Error(rpcError.message), {
      order_id: order.id,
      refund_id: refund.id,
      path: "admin_refund",
      db_error: rpcError.message,
      rpc_code: rpcError.code ?? "none",
    });
    return NextResponse.json(
      {
        refund_id: refund.id,
        warning: `[REFUND_DB_DRIFT] order=${order.id} refund_id=${refund.id} ${rpcError.message}`,
      },
      { status: 500 },
    );
  }

  // Refunded sort le filtre IN ('confirmed','completed') du cache
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
    const { error: notifErr } = await admin.from("notifications").insert({
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
    if (notifErr) {
      console.error(
        `[NOTIF_INSERT_ERR] template=order_refunded order_id=${order.id} error=${notifErr.message}`,
      );
    }
  }

  return NextResponse.json({ refund_id: refund.id });
}
