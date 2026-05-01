import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import {
  assertTransition,
  type OrderStatus,
} from "@/lib/orders/stateMachine";
import { revalidatePublicStats } from "@/lib/stats/revalidate";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";

// Extrait du handler webhook `payment_intent.payment_failed` (cf
// app/api/stripe/webhook/route.tsx). Sortie en module séparé pour pouvoir
// tester en isolation : le case dans route.tsx reste un thin wrapper qui
// appelle cette fonction puis ack 200.
//
// Sémantique :
//   - Si le PI n'a pas d'order_id en metadata → no-op (cas hors flow
//     consumer, ex. SetupIntent pour ensure-default-payment-method).
//   - Si l'order n'existe pas → log warn + no-op (orphelin / RGPD).
//   - Si l'order est déjà terminale (cancelled/refunded/completed) → no-op
//     idempotent. Couvre le webhook rejoué ET le cas litige post-retrait.
//   - 🛡️ Guard rétrogradation : si l'order est en `confirmed` ou `ready`,
//     no-op + log warn. Une fois confirmée par un payment_intent.succeeded,
//     une commande ne doit JAMAIS rétrograder à cancelled par un event
//     failed tardif (rare mais possible : rejouage webhook, race latence
//     réseau). Le payment a réussi, le producer a été notifié, c'est figé.
//   - Cas nominal `pending → cancelled` : assertTransition (state machine
//     est la source de vérité), UPDATE avec closure_reason='payment_failed'
//     pour permettre le filtrage UI consumer (la commande n'a jamais été
//     "engagée" du point de vue consumer). revalidatePublicStats car le
//     count public est filtré sur statut IN ('confirmed','ready','completed').
//
// Logs préfixés grep-able pour Vercel (cohérent avec le pattern projet
// [STRIPE_*], [WEBHOOK_*], [STATS_REVAL_WARN], etc.).
//
// Audit log Phase 2 (commit 2 chantier "résurrection robuste") : sur le
// path nominal `cancelled` (pending → cancelled+payment_failed), un event
// `order_payment_failed` est poussé dans audit_logs pour traçabilité
// forensique (PCI DSS 10.x). Pas de log sur les paths idempotents
// (already_terminal, guard_confirmed) pour ne pas dupliquer la trace au
// rejouage. Les paths techniques (no_metadata, order_not_found) loguent
// déjà via console.warn préfixé grep-able, suffisant pour Vercel logs.

export type PaymentFailedResult =
  | "no_metadata"
  | "order_not_found"
  | "already_terminal"
  | "guard_confirmed"
  | "cancelled";

export async function syncStripePaymentFailed(
  paymentIntent: Stripe.PaymentIntent,
  admin: SupabaseClient,
): Promise<{ result: PaymentFailedResult; orderId: string | null }> {
  const orderId = paymentIntent.metadata?.order_id;
  if (!orderId) {
    return { result: "no_metadata", orderId: null };
  }

  const { data: order, error: fetchError } = await admin
    .from("orders")
    .select("id, statut, consumer_id")
    .eq("id", orderId)
    .maybeSingle();

  if (fetchError) {
    console.warn(
      `[WEBHOOK_FAILED_FETCH_ERR] order=${orderId} pi=${paymentIntent.id} error=${fetchError.message}`,
    );
    return { result: "order_not_found", orderId };
  }

  if (!order) {
    console.warn(
      `[WEBHOOK_FAILED_NO_ORDER] order=${orderId} pi=${paymentIntent.id} not found in DB`,
    );
    return { result: "order_not_found", orderId };
  }

  const currentStatus = order.statut as OrderStatus;

  // Idempotence + cas litige post-retrait : déjà terminal → no-op.
  if (
    currentStatus === "cancelled" ||
    currentStatus === "refunded" ||
    currentStatus === "completed"
  ) {
    return { result: "already_terminal", orderId };
  }

  // 🛡️ Guard : payment a déjà été confirmé/préparé. Une commande
  // confirmed/ready ne doit JAMAIS rétrograder à cancelled par un event
  // failed tardif (rejouage webhook, race latence). Le producer a été
  // notifié, l'argent est encaissé, l'état est figé.
  if (currentStatus === "confirmed" || currentStatus === "ready") {
    console.warn(
      `[WEBHOOK_FAILED_AFTER_SUCCEEDED_NOOP] order=${orderId} pi=${paymentIntent.id} status=${currentStatus} — refused to downgrade`,
    );
    return { result: "guard_confirmed", orderId };
  }

  // Cas nominal : pending → cancelled.
  assertTransition(currentStatus, "cancelled");

  await admin
    .from("orders")
    .update({
      statut: "cancelled",
      cancelled_at: new Date().toISOString(),
      closure_reason: "payment_failed",
    })
    .eq("id", orderId);

  // Le count public dépend du statut → invalidation cache.
  await revalidatePublicStats({ source: "stripe-payment-failed", orderId });

  // Audit log forensique (Phase 2 audit_logs payment events).
  await logPaymentEvent({
    eventType: "order_payment_failed",
    userId: (order.consumer_id as string | null) ?? null,
    metadata: {
      order_id: orderId,
      payment_intent_id: paymentIntent.id,
    },
  });

  return { result: "cancelled", orderId };
}
