import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { waitUntil } from "@vercel/functions";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";
import { sendTemplate } from "@/lib/resend/send";
import { SUPPORT_EMAIL } from "@/lib/env/support-email";
import { reverseTransferIfNeeded } from "@/lib/stripe/reverse-transfer";
import { sendOpsAlert } from "@/lib/ops/alert";
import AdminDisputeClosed, {
  subject as adminDisputeClosedSubject,
  type DisputeOutcome,
} from "@/lib/resend/templates/admin-dispute-closed";

// Extrait du handler webhook `charge.dispute.closed` (cf
// app/api/stripe/webhook/route.tsx). Stripe émet cet event quand un dispute
// passe à un état terminal — won, lost, ou warning_closed (Visa CE3.0).
// Pas d'urgence : la résolution est définitive, info-only pour l'admin.
//
// Sémantique :
//   1. Mapping Stripe.status -> enum public.disputes.status terminal.
//      Statuts non-terminaux (under_review, warning_*) routés ici sont
//      logués warn et ignorés (devrait passer par dispute.updated).
//   2. UPDATE public.disputes SET status=mapped, closed_at=now(),
//      updated_at=now() WHERE stripe_dispute_id=$1. Si pas trouvé ->
//      warn log + return 'not_found'.
//   3. Audit log forensique stripe_dispute avec dispute_status final +
//      transition='closed'.
//   4. INSERT notifications placeholder admin (template='admin_dispute_closed').
//   5. waitUntil(sendTemplate(... template='admin-dispute-closed')) info-only.
//
// Logs préfixés grep-able : [STRIPE_DISPUTE_CLOSED], [STRIPE_DISPUTE_CLOSED_NOT_FOUND].

export type DisputeClosedResult = "closed" | "not_found";

const STRIPE_TO_DB_TERMINAL: Record<string, DisputeOutcome> = {
  won: "won",
  lost: "lost",
  warning_closed: "warning_closed",
};

export async function syncStripeDisputeClosed(
  dispute: Stripe.Dispute,
  admin: SupabaseClient,
): Promise<{ result: DisputeClosedResult; orderId: string | null }> {
  const stripeStatus = dispute.status;
  const outcome = STRIPE_TO_DB_TERMINAL[stripeStatus] ?? null;

  if (!outcome) {
    console.warn(
      `[STRIPE_DISPUTE_CLOSED_NON_TERMINAL] dispute=${dispute.id} stripe_status=${stripeStatus} — devrait être routé via dispute.updated`,
    );
    await logPaymentEvent({
      eventType: "stripe_dispute",
      metadata: {
        dispute_id: dispute.id,
        stripe_status: stripeStatus,
        dispute_status: null,
        transition: "closed_non_terminal",
        requires_action: false,
      },
    });
    return { result: "not_found", orderId: null };
  }

  // UPDATE puis SELECT order_id pour les besoins email + audit.
  const nowIso = new Date().toISOString();
  const { data: updated, error: updateError } = await admin
    .from("disputes")
    .update({ status: outcome, closed_at: nowIso, updated_at: nowIso })
    .eq("stripe_dispute_id", dispute.id)
    .select("id, order_id, amount, currency, reason");

  if (updateError) {
    console.warn(
      `[STRIPE_DISPUTE_CLOSED_UPDATE_ERR] dispute=${dispute.id} error=${(updateError as { message?: string }).message ?? "unknown"}`,
    );
  }

  const matched = Array.isArray(updated) && updated.length > 0;
  const row = matched
    ? (updated[0] as {
        id: string;
        order_id: string;
        amount: number;
        currency: string;
        reason: string | null;
      })
    : null;
  const orderId = row?.order_id ?? null;

  if (!matched) {
    console.warn(
      `[STRIPE_DISPUTE_CLOSED_NOT_FOUND] dispute=${dispute.id} outcome=${outcome} — disputes row introuvable`,
    );
  } else {
    console.log(
      `[STRIPE_DISPUTE_CLOSED] dispute=${dispute.id} order=${orderId} outcome=${outcome}`,
    );
  }

  // Lookup order code_commande pour l'email.
  let codeCommande: string | null = null;
  if (orderId) {
    const { data: order } = await admin
      .from("orders")
      .select("code_commande")
      .eq("id", orderId)
      .maybeSingle();
    codeCommande =
      (order as { code_commande?: string | null } | null)?.code_commande ?? null;
  }

  // F-004 sub-3 (audit pré-launch 2026-05-10) — Reversal automatique sur
  // dispute lost. Standalone, pas de refund derrière : le chargeback Stripe
  // a DÉJÀ débité la platform balance au moment où Stripe a marqué le dispute
  // 'lost'. Le reversal récupère le montant côté Connect account producer
  // (qui avait reçu son net via le cron weekly-payout post-completion) pour
  // que la perte commerciale ne soit pas absorbée par TerrOir.
  //
  // Logique :
  //   - outcome !== 'lost' → noop (won = on garde les fonds, warning_closed = pas de débit)
  //   - outcome === 'lost' + orderId NULL → noop (dispute orphelin sans match)
  //   - outcome === 'lost' + orderId présent → appel helper (qui re-fetch transfer_id DB) :
  //       reversed | noop_no_transfer_id | noop_lookup_failed | failed
  //
  // Comportement kind='failed' sur ce path dispute lost :
  //   - sendOpsAlert [DISPUTE_LOST_REVERSAL_FAILED] → admin investigue manuellement.
  //   - Pas de "refund à bloquer" ici (le chargeback est définitif côté Stripe).
  // Refacto futur : si tu uniformises ce comportement, vérifie l'invariant
  // par caller dans le commit de référence F-004 sub-3.
  if (outcome === "lost" && orderId && row) {
    const reversal = await reverseTransferIfNeeded({
      admin,
      orderId,
      amountEur: Number(row.amount),
      source: "dispute_lost",
    });
    if (reversal.kind === "failed") {
      await sendOpsAlert(
        "[DISPUTE_LOST_REVERSAL_FAILED]",
        new Error(reversal.error),
        {
          order_id: orderId,
          dispute_id: dispute.id,
          transfer_id: reversal.transferId,
          amount: Number(row.amount),
        },
      );
    }
  }

  // Audit log forensique.
  await logPaymentEvent({
    eventType: "stripe_dispute",
    metadata: {
      dispute_id: dispute.id,
      order_id: orderId,
      stripe_status: stripeStatus,
      dispute_status: outcome,
      transition: "closed",
      requires_action: false,
      matched,
    },
  });

  // Notification placeholder DB.
  await admin.from("notifications").insert({
    user_id: null,
    type: "email",
    template: "admin_dispute_closed",
    statut: "sent",
    metadata: {
      dispute_id: dispute.id,
      order_id: orderId,
      outcome,
    },
  });

  // Email info-only admin.
  const amountEuros = (row?.amount ?? dispute.amount / 100);
  const currency = row?.currency ?? dispute.currency;
  const reason = row?.reason ?? dispute.reason ?? null;
  const dashboardUrl = `https://dashboard.stripe.com/disputes/${dispute.id}`;
  const props = {
    outcome,
    codeCommande,
    amount: Number(amountEuros),
    currency,
    reason,
    disputeId: dispute.id,
    dashboardUrl,
  };
  waitUntil(
    sendTemplate({
      to: SUPPORT_EMAIL,
      userId: null,
      template: "admin_dispute_closed",
      subject: adminDisputeClosedSubject(props),
      element: <AdminDisputeClosed {...props} />,
      metadata: {
        dispute_id: dispute.id,
        order_id: orderId,
        outcome,
      },
    }).catch((err) => {
      console.error(
        `[STRIPE_DISPUTE_CLOSED_EMAIL_ERR] dispute=${dispute.id} error=${(err as Error).message}`,
      );
    }),
  );

  return { result: matched ? "closed" : "not_found", orderId };
}
