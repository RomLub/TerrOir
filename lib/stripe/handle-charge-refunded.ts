import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";

// Audit Stripe phase 2 M-3 (2026-05-05) — handler webhook `charge.refunded`.
// Stripe émet cet event quand un refund est settled côté Stripe (≠ émission
// via refund.created). Pose un audit log forensique pour reconstitution
// chronologie comptable (payment → refund émis → refund settled).
//
// Décision autonome (vs brief initial) : aucune table `refunds` n'existe dans
// le schéma TerrOir V1. Les refunds vivent dans :
//   - audit_logs (event order_admin_refund_*, order_revival_blocked_*, etc.)
//     posés à l'émission, pour forensique RGPD/PCI ;
//   - refund_incidents + refund_incident_attempts (T-102) pour le retry
//     workflow des échecs.
// Le settlement Stripe est une info forensique additionnelle, pas un état
// business critique. Donc audit log seul, sans nouvelle migration. Si V1.x
// nécessite une colonne settled_at dédiée (audit comptable plus formel),
// l'ajouter sur refund_incident_attempts (UPDATE WHERE stripe_refund_id =
// charge.refunds.data[*].id).
//
// Sémantique :
//   1. Lookup order via charge.payment_intent (string ou objet expandé).
//   2. Audit log stripe_charge_refunded_settled avec metadata étendue
//      (charge_id, payment_intent_id, order_id, amount, amount_refunded,
//      refunded bool, currency, refund_count, order_match).
//
// Logs préfixés grep-able : [STRIPE_CHARGE_REFUNDED], [STRIPE_CHARGE_REFUNDED_NO_ORDER].

export type ChargeRefundedResult = "logged" | "no_order_match";

export async function syncStripeChargeRefunded(
  charge: Stripe.Charge,
  admin: SupabaseClient,
): Promise<{ result: ChargeRefundedResult; orderId: string | null }> {
  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : (charge.payment_intent?.id ?? null);

  // L'event est émis sur des charges qui ont AU MOINS 1 refund. Le
  // refund_count permet de discriminer les refunds partiels successifs
  // (TerrOir n'en émet pas en V1, mais l'audit log doit rester précis).
  const refundCount =
    typeof charge.refunds === "object" && charge.refunds && "data" in charge.refunds
      ? (charge.refunds.data?.length ?? 0)
      : 0;
  const lastRefundId =
    typeof charge.refunds === "object" && charge.refunds && "data" in charge.refunds
      ? (charge.refunds.data?.[charge.refunds.data.length - 1]?.id ?? null)
      : null;

  // 1. Lookup order.
  let orderId: string | null = null;
  let consumerId: string | null = null;
  if (paymentIntentId) {
    const { data } = await admin
      .from("orders")
      .select("id, consumer_id")
      .eq("stripe_payment_intent_id", paymentIntentId)
      .maybeSingle();
    if (data) {
      const row = data as { id: string; consumer_id: string | null };
      orderId = row.id;
      consumerId = row.consumer_id ?? null;
    }
  }

  if (!orderId) {
    console.warn(
      `[STRIPE_CHARGE_REFUNDED_NO_ORDER] charge=${charge.id} payment_intent=${paymentIntentId ?? "null"} amount_refunded=${charge.amount_refunded}`,
    );
    await logPaymentEvent({
      eventType: "stripe_charge_refunded_settled",
      metadata: {
        charge_id: charge.id,
        payment_intent_id: paymentIntentId,
        amount: charge.amount,
        amount_refunded: charge.amount_refunded,
        currency: charge.currency,
        refunded: charge.refunded,
        refund_count: refundCount,
        last_refund_id: lastRefundId,
        order_match: false,
      },
    });
    return { result: "no_order_match", orderId: null };
  }

  console.log(
    `[STRIPE_CHARGE_REFUNDED] charge=${charge.id} order=${orderId} amount_refunded=${charge.amount_refunded} refunded=${charge.refunded}`,
  );

  // 2. Audit log forensique avec order match.
  await logPaymentEvent({
    eventType: "stripe_charge_refunded_settled",
    userId: consumerId,
    metadata: {
      charge_id: charge.id,
      payment_intent_id: paymentIntentId,
      order_id: orderId,
      amount: charge.amount,
      amount_refunded: charge.amount_refunded,
      currency: charge.currency,
      refunded: charge.refunded,
      refund_count: refundCount,
      last_refund_id: lastRefundId,
      order_match: true,
    },
  });

  return { result: "logged", orderId };
}
