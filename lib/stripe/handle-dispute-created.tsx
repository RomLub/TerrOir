import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { waitUntil } from "@vercel/functions";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";
import { sendTemplate } from "@/lib/resend/send";
import { SUPPORT_EMAIL } from "@/lib/env/support-email";
import AdminDisputeActionRequired, {
  subject as adminDisputeActionRequiredSubject,
} from "@/lib/resend/templates/admin-dispute-action-required";

// Extrait du handler webhook `charge.dispute.created` (cf
// app/api/stripe/webhook/route.tsx). Stripe émet cet event quand un client
// ouvre un litige (chargeback) auprès de sa banque sur une commande déjà
// encaissée. Sans réponse avant la deadline `evidence_due_by`, Stripe perd
// automatiquement le litige et retire les fonds + commission Stripe.
//
// Sémantique :
//   1. Lookup `orders.id` via `dispute.payment_intent` -> `orders.stripe_payment_intent_id`.
//      Si pas de PI dans le dispute (cas rare) ou order introuvable -> log warn,
//      le row disputes est tout de même créé sans order_id ? NON — order_id
//      est NOT NULL (FK contrainte). Si pas d'order match, return 'no_order_match'
//      sans INSERT (dispute orphelin investigation manuelle Romain).
//   2. INSERT public.disputes (status='needs_response', stripe_dispute_id UNIQUE,
//      reason, amount, currency, evidence_due_by, metadata).
//      Sur SQLSTATE 23505 (rejouage Stripe ou dispute déjà persisté avant
//      dédup webhook T-103) -> return 'duplicate' sans effets de bord.
//   3. Audit log `stripe_dispute` avec metadata étendue (requires_action: true,
//      evidence_due_by, dispute_status). Décision PUSH 1 question C : pas
//      de nouveau event-type synonyme, on étend metadata.
//   4. INSERT notifications placeholder admin.
//   5. waitUntil(sendTemplate(... to=SUPPORT_EMAIL, template='admin-dispute-action-required')).
//
// Logs préfixés grep-able : [STRIPE_DISPUTE_CREATED], [STRIPE_DISPUTE_CREATED_NO_ORDER],
// [STRIPE_DISPUTE_CREATED_DUPLICATE].

export type DisputeCreatedResult = "created" | "no_order_match" | "duplicate";

const PG_UNIQUE_VIOLATION = "23505";

export async function syncStripeDisputeCreated(
  dispute: Stripe.Dispute,
  admin: SupabaseClient,
): Promise<{ result: DisputeCreatedResult; orderId: string | null }> {
  const chargeId =
    typeof dispute.charge === "string"
      ? dispute.charge
      : (dispute.charge?.id ?? null);
  const paymentIntentId =
    typeof dispute.payment_intent === "string"
      ? dispute.payment_intent
      : (dispute.payment_intent?.id ?? null);
  const evidenceDueByUnix = dispute.evidence_details?.due_by ?? null;
  const evidenceDueByIso = evidenceDueByUnix
    ? new Date(evidenceDueByUnix * 1000).toISOString()
    : null;

  // 1. Lookup order via stripe_payment_intent_id (cf colonne sur public.orders,
  // initial_schema L107).
  let orderId: string | null = null;
  let order: {
    id: string;
    code_commande: string | null;
    consumer_id: string | null;
  } | null = null;
  if (paymentIntentId) {
    const { data } = await admin
      .from("orders")
      .select("id, code_commande, consumer_id")
      .eq("stripe_payment_intent_id", paymentIntentId)
      .maybeSingle();
    if (data) {
      order = data as {
        id: string;
        code_commande: string | null;
        consumer_id: string | null;
      };
      orderId = order.id;
    }
  }

  if (!orderId) {
    console.warn(
      `[STRIPE_DISPUTE_CREATED_NO_ORDER] dispute=${dispute.id} payment_intent=${paymentIntentId ?? "null"} charge=${chargeId ?? "null"} — order introuvable`,
    );
    // Audit log quand même pour traçabilité forensique.
    await logPaymentEvent({
      eventType: "stripe_dispute",
      metadata: {
        dispute_id: dispute.id,
        charge_id: chargeId,
        payment_intent_id: paymentIntentId,
        amount: dispute.amount,
        currency: dispute.currency,
        reason: dispute.reason,
        status: dispute.status,
        dispute_status: "needs_response",
        evidence_due_by: evidenceDueByUnix,
        requires_action: true,
        order_match: false,
      },
    });
    return { result: "no_order_match", orderId: null };
  }

  // 2. INSERT public.disputes. Catch 23505 = duplicate (rejouage Stripe ou
  // event déjà persisté avant dédup T-103, défensif).
  const amountEuros = dispute.amount / 100;
  const { error: insertError } = await admin.from("disputes").insert({
    order_id: orderId,
    stripe_dispute_id: dispute.id,
    stripe_charge_id: chargeId,
    status: "needs_response",
    reason: dispute.reason ?? null,
    amount: amountEuros,
    currency: dispute.currency,
    evidence_due_by: evidenceDueByIso,
    metadata: {
      stripe_status: dispute.status,
      payment_intent_id: paymentIntentId,
    },
  });

  if (insertError) {
    const code = (insertError as { code?: string }).code;
    if (code === PG_UNIQUE_VIOLATION) {
      console.log(
        `[STRIPE_DISPUTE_CREATED_DUPLICATE] dispute=${dispute.id} order=${orderId} — déjà persisté`,
      );
      return { result: "duplicate", orderId };
    }
    console.error(
      `[STRIPE_DISPUTE_CREATED_INSERT_ERR] dispute=${dispute.id} order=${orderId} error=${(insertError as { message?: string }).message ?? "unknown"}`,
    );
    // On continue : l'audit log + email doivent partir même si INSERT a
    // échoué (visibilité admin > intégrité table). Romain pourra reposer
    // manuellement le row depuis Dashboard Stripe.
  }

  console.error(
    `[STRIPE_DISPUTE_CREATED] dispute=${dispute.id} order=${orderId} amount=${dispute.amount} reason=${dispute.reason} due=${evidenceDueByIso}`,
  );

  // 3. Audit log forensique (extension metadata, pas de nouveau event-type).
  await logPaymentEvent({
    eventType: "stripe_dispute",
    userId: order?.consumer_id ?? null,
    metadata: {
      dispute_id: dispute.id,
      charge_id: chargeId,
      payment_intent_id: paymentIntentId,
      order_id: orderId,
      amount: dispute.amount,
      currency: dispute.currency,
      reason: dispute.reason,
      status: dispute.status,
      dispute_status: "needs_response",
      evidence_due_by: evidenceDueByUnix,
      requires_action: true,
      order_match: true,
    },
  });

  // 4. Notification placeholder DB.
  await admin.from("notifications").insert({
    user_id: null,
    type: "email",
    template: "admin_dispute_action_required",
    statut: "sent",
    metadata: {
      dispute_id: dispute.id,
      order_id: orderId,
      amount: dispute.amount,
      currency: dispute.currency,
      reason: dispute.reason,
      evidence_due_by: evidenceDueByUnix,
    },
  });

  // 5. Email réel admin.
  let customerEmail: string | null = null;
  if (order?.consumer_id) {
    const { data: consumer } = await admin
      .from("users")
      .select("email")
      .eq("id", order.consumer_id)
      .maybeSingle();
    customerEmail =
      (consumer as { email?: string | null } | null)?.email ?? null;
  }

  const evidenceDueByHuman = evidenceDueByIso
    ? evidenceDueByIso.slice(0, 10)
    : null;
  const dashboardUrl = `https://dashboard.stripe.com/disputes/${dispute.id}`;
  const props = {
    codeCommande: order?.code_commande ?? null,
    customerEmail,
    amount: amountEuros,
    currency: dispute.currency,
    reason: dispute.reason ?? null,
    evidenceDueBy: evidenceDueByHuman,
    disputeId: dispute.id,
    dashboardUrl,
  };
  waitUntil(
    sendTemplate({
      to: SUPPORT_EMAIL,
      userId: null,
      template: "admin_dispute_action_required",
      subject: adminDisputeActionRequiredSubject(props),
      element: <AdminDisputeActionRequired {...props} />,
      metadata: {
        dispute_id: dispute.id,
        order_id: orderId,
      },
    }).catch((err) => {
      console.error(
        `[STRIPE_DISPUTE_CREATED_EMAIL_ERR] dispute=${dispute.id} error=${(err as Error).message}`,
      );
    }),
  );

  return { result: "created", orderId };
}
