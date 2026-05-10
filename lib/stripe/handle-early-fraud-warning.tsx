import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { waitUntil } from "@vercel/functions";
import { stripe } from "@/lib/stripe/server";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";
import { classifyRefundError } from "@/lib/refund-incidents/classify-error";
import { recordRefundAttempt } from "@/lib/refund-incidents/record-refund-attempt";
import { sendTemplate } from "@/lib/resend/send";
import { SUPPORT_EMAIL } from "@/lib/env/support-email";
import AdminEarlyFraudWarning, {
  subject as adminEarlyFraudWarningSubject,
} from "@/lib/resend/templates/admin-early-fraud-warning";

// Audit Stripe phase 2 M-3 (2026-05-05) — handler webhook
// `radar.early_fraud_warning.created`. Visa/MC notifient Stripe d'une
// potentielle fraude AVANT que le client ouvre un dispute. Si on refund
// pré-emptivement, on évite ~15€ de chargeback fee + la perte commerce.
//
// Sémantique :
//   1. Lookup PaymentIntent associé via efw.payment_intent (priorité) ou
//      efw.charge (fallback : retrieve charge -> charge.payment_intent).
//   2. Lookup orders.id via stripe_payment_intent_id. Si pas trouvé →
//      result='no_order_match' (orphelin investigation manuelle).
//   3. Si order déjà refundée (statut='refunded') → idempotent, audit log
//      seul, pas de 2e refund.
//   4. Sinon : émission refund Stripe avec idempotency-key
//      `refund_${orderId}_efw` (cohérent avec conventions L-6 admin/timeout/
//      revival). UPDATE order statut='refunded' + closure_reason=
//      'efw_preemptive'.
//   5. Audit log forensique stripe_early_fraud_warning_received.
//   6. waitUntil(sendTemplate(... admin EFW alert)).
//
// Logs préfixés grep-able : [STRIPE_EFW_RECEIVED], [STRIPE_EFW_NO_ORDER],
// [STRIPE_EFW_ALREADY_REFUNDED], [STRIPE_EFW_REFUND_FAILED].

export type EarlyFraudWarningResult =
  | "refunded"
  | "already_refunded"
  | "refund_failed"
  | "no_order_match";

export async function syncStripeEarlyFraudWarning(
  efw: Stripe.Radar.EarlyFraudWarning,
  admin: SupabaseClient,
): Promise<{ result: EarlyFraudWarningResult; orderId: string | null }> {
  const chargeId =
    typeof efw.charge === "string" ? efw.charge : (efw.charge?.id ?? null);
  let paymentIntentId =
    typeof efw.payment_intent === "string"
      ? efw.payment_intent
      : (efw.payment_intent?.id ?? null);

  // Fallback : si l'EFW ne porte pas directement le PI, on retrieve la charge
  // pour récupérer charge.payment_intent. Pas systématique (préserve quota
  // API Stripe) — uniquement si PI manquant et chargeId présent.
  if (!paymentIntentId && chargeId) {
    try {
      const charge = await stripe.charges.retrieve(chargeId);
      paymentIntentId =
        typeof charge.payment_intent === "string"
          ? charge.payment_intent
          : (charge.payment_intent?.id ?? null);
    } catch (err) {
      console.warn(
        `[STRIPE_EFW_CHARGE_FETCH_ERR] efw=${efw.id} charge=${chargeId} error=${(err as Error).message}`,
      );
    }
  }

  // 1. Lookup order.
  type OrderRow = {
    id: string;
    statut: string;
    code_commande: string | null;
    consumer_id: string | null;
    montant_total: unknown;
  };
  let orderId: string | null = null;
  let order: OrderRow | null = null;

  if (paymentIntentId) {
    const { data } = await admin
      .from("orders")
      .select("id, statut, code_commande, consumer_id, montant_total")
      .eq("stripe_payment_intent_id", paymentIntentId)
      .maybeSingle();
    if (data) {
      order = data as OrderRow;
      orderId = order.id;
    }
  }

  if (!orderId) {
    console.warn(
      `[STRIPE_EFW_NO_ORDER] efw=${efw.id} payment_intent=${paymentIntentId ?? "null"} charge=${chargeId ?? "null"} fraud_type=${efw.fraud_type}`,
    );
    await logPaymentEvent({
      eventType: "stripe_early_fraud_warning_received",
      metadata: {
        efw_id: efw.id,
        charge_id: chargeId,
        payment_intent_id: paymentIntentId,
        fraud_type: efw.fraud_type,
        actionable: efw.actionable,
        order_match: false,
      },
    });
    return { result: "no_order_match", orderId: null };
  }

  const consumerId = order?.consumer_id ?? null;
  const codeCommande = order?.code_commande ?? null;

  // 2. Idempotence : order déjà refundée → log audit + return sans 2e refund.
  if (order?.statut === "refunded") {
    console.log(
      `[STRIPE_EFW_ALREADY_REFUNDED] efw=${efw.id} order=${orderId} — refund déjà émis, audit log seul`,
    );
    await logPaymentEvent({
      eventType: "stripe_early_fraud_warning_received",
      userId: consumerId,
      metadata: {
        efw_id: efw.id,
        charge_id: chargeId,
        payment_intent_id: paymentIntentId,
        order_id: orderId,
        fraud_type: efw.fraud_type,
        actionable: efw.actionable,
        order_match: true,
        refund_action: "skipped_already_refunded",
      },
    });
    return { result: "already_refunded", orderId };
  }

  if (!paymentIntentId) {
    // Defensif : pas de PI à refund (n'arrive pas si le lookup ci-dessus
    // est passé, puisque le SELECT order utilise stripe_payment_intent_id).
    console.warn(
      `[STRIPE_EFW_NO_PI] efw=${efw.id} order=${orderId} — pas de PI pour refund`,
    );
    await logPaymentEvent({
      eventType: "stripe_early_fraud_warning_received",
      userId: consumerId,
      metadata: {
        efw_id: efw.id,
        charge_id: chargeId,
        order_id: orderId,
        fraud_type: efw.fraud_type,
        order_match: true,
        refund_action: "skipped_no_pi",
      },
    });
    return { result: "no_order_match", orderId };
  }

  // 3. Refund pré-emptif. Idempotency-key spécifique au path EFW.
  let refund: Stripe.Refund | null = null;
  try {
    refund = await stripe.refunds.create(
      { payment_intent: paymentIntentId },
      { idempotencyKey: `refund_${orderId}_efw` },
    );
  } catch (refundErr) {
    console.error(
      `[STRIPE_EFW_REFUND_FAILED] efw=${efw.id} order=${orderId} pi=${paymentIntentId} error=${(refundErr as Error).message}`,
    );
    const classified = classifyRefundError(refundErr);
    // Pattern T-102.2.b — instrumentation refund_incidents pour cohérence
    // avec les autres paths refund. kind='admin' (le path EFW est piloté
    // côté plateforme, pas par le consumer ni par un timeout) jusqu'à ce
    // qu'on ouvre un kind='efw' explicite si besoin.
    await recordRefundAttempt({
      orderId,
      kind: "admin",
      paymentIntentId,
      consumerId,
      blockedReason: null,
      outcome: "failed",
      classified,
    });
    await logPaymentEvent({
      eventType: "stripe_early_fraud_warning_received",
      userId: consumerId,
      metadata: {
        efw_id: efw.id,
        charge_id: chargeId,
        payment_intent_id: paymentIntentId,
        order_id: orderId,
        fraud_type: efw.fraud_type,
        actionable: efw.actionable,
        order_match: true,
        refund_action: "failed",
        refund_error_code: classified.code,
        refund_error_category: classified.category,
        refund_error_message: classified.message,
      },
    });
    return { result: "refund_failed", orderId };
  }

  // 4. F-001 P0-TA : transition * → refunded via RPC SECDEF cancel_order.
  // p_reason='efw_preemptive' ∈ skip-list audit RPC (l'audit
  // `stripe_early_fraud_warning_received` posé ci-dessous porte le
  // contexte EFW Stripe complet). Refund Stripe émis OK mais RPC ratée →
  // drift, on continue le flow (audit log + email) pour visibilité admin.
  const { error: rpcError } = await admin.rpc("cancel_order", {
    p_order_id: orderId,
    p_reason: "efw_preemptive",
    p_target_status: "refunded",
  });

  if (rpcError) {
    console.warn(
      `[STRIPE_EFW_RPC_ERR] efw=${efw.id} order=${orderId} refund=${refund.id} code=${rpcError.code ?? "none"} error=${rpcError.message}`,
    );
  }

  console.error(
    `[STRIPE_EFW_RECEIVED] efw=${efw.id} order=${orderId} refund=${refund.id} fraud_type=${efw.fraud_type} actionable=${efw.actionable}`,
  );

  // 5. Audit forensique.
  await logPaymentEvent({
    eventType: "stripe_early_fraud_warning_received",
    userId: consumerId,
    metadata: {
      efw_id: efw.id,
      charge_id: chargeId,
      payment_intent_id: paymentIntentId,
      order_id: orderId,
      fraud_type: efw.fraud_type,
      actionable: efw.actionable,
      order_match: true,
      refund_action: "succeeded",
      refund_id: refund.id,
    },
  });

  // 6. Email admin.
  const amountEuros = Number(order?.montant_total ?? 0);
  const dashboardUrl = `https://dashboard.stripe.com/radar/early-fraud-warnings/${efw.id}`;
  const props = {
    codeCommande,
    fraudType: efw.fraud_type,
    actionable: efw.actionable,
    amount: amountEuros,
    refundId: refund.id,
    orderId,
    efwId: efw.id,
    paymentIntentId,
    dashboardUrl,
  };
  waitUntil(
    sendTemplate({
      to: SUPPORT_EMAIL,
      userId: null,
      template: "admin_early_fraud_warning",
      subject: adminEarlyFraudWarningSubject(props),
      element: <AdminEarlyFraudWarning {...props} />,
      metadata: {
        efw_id: efw.id,
        order_id: orderId,
        refund_id: refund.id,
      },
    }).catch((err) => {
      console.error(
        `[STRIPE_EFW_EMAIL_ERR] efw=${efw.id} order=${orderId} error=${(err as Error).message}`,
      );
    }),
  );

  return { result: "refunded", orderId };
}
