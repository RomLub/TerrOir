import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";

// Extrait du handler webhook `charge.dispute.updated` (cf
// app/api/stripe/webhook/route.tsx). Stripe émet cet event à chaque
// transition d'état pendant le cycle de vie d'un dispute (evidence
// soumise → status='under_review', warning Visa CE3.0, etc.).
//
// Sémantique :
//   1. Mapping Stripe.status -> enum public.disputes.status :
//        - under_review            -> under_review
//        - warning_under_review    -> warning_under_review
//        - warning_needs_response  -> warning_needs_response
//      Statuts terminaux (won/lost/warning_closed) sont gérés par
//      handle-dispute-closed.ts via charge.dispute.closed (ne devraient
//      pas arriver ici, mais on log warn si c'est le cas).
//   2. UPDATE public.disputes SET status=mappedStatus, updated_at=now()
//      WHERE stripe_dispute_id=$1. Si aucune row matchée -> warn log +
//      return 'not_found' (dispute non capturé par dispute.created —
//      orphelin investigation Romain).
//   3. Audit log forensique stripe_dispute (extension metadata transition).
//
// Pas d'email ni notification placeholder : updated est purement
// informationnel pendant le cycle de vie. L'admin reçoit déjà l'alerte
// urgente sur dispute.created et l'info finale sur dispute.closed.

export type DisputeUpdatedResult = "updated" | "not_found";

const STRIPE_TO_DB_STATUS: Record<string, string> = {
  under_review: "under_review",
  warning_under_review: "warning_under_review",
  warning_needs_response: "warning_needs_response",
};

export async function syncStripeDisputeUpdated(
  dispute: Stripe.Dispute,
  admin: SupabaseClient,
): Promise<{ result: DisputeUpdatedResult }> {
  const stripeStatus = dispute.status;
  const mappedStatus = STRIPE_TO_DB_STATUS[stripeStatus] ?? null;

  if (!mappedStatus) {
    // Statut terminal (won/lost/warning_closed) ou inconnu — devrait être
    // routé par dispute.closed ou indique un nouvel état Stripe non couvert.
    console.warn(
      `[STRIPE_DISPUTE_UPDATED_UNKNOWN_STATUS] dispute=${dispute.id} stripe_status=${stripeStatus} — no DB mapping`,
    );
    // Audit log quand même pour traçabilité forensique.
    await logPaymentEvent({
      eventType: "stripe_dispute",
      metadata: {
        dispute_id: dispute.id,
        stripe_status: stripeStatus,
        dispute_status: null,
        transition: "updated_unknown",
        requires_action: false,
      },
    });
    return { result: "not_found" };
  }

  // UPDATE en select pour récupérer la row touchée et savoir si elle existait.
  const { data: updated, error: updateError } = await admin
    .from("disputes")
    .update({ status: mappedStatus, updated_at: new Date().toISOString() })
    .eq("stripe_dispute_id", dispute.id)
    .select("id, order_id");

  if (updateError) {
    console.warn(
      `[STRIPE_DISPUTE_UPDATED_UPDATE_ERR] dispute=${dispute.id} error=${(updateError as { message?: string }).message ?? "unknown"}`,
    );
  }

  const matched = Array.isArray(updated) && updated.length > 0;
  const orderId = matched
    ? String((updated[0] as { order_id: unknown }).order_id ?? "") || null
    : null;

  if (!matched) {
    console.warn(
      `[STRIPE_DISPUTE_UPDATED_NOT_FOUND] dispute=${dispute.id} status=${mappedStatus} — disputes row introuvable (orphelin dispute.created manqué ?)`,
    );
  } else {
    console.log(
      `[STRIPE_DISPUTE_UPDATED] dispute=${dispute.id} order=${orderId} status=${mappedStatus}`,
    );
  }

  // Audit log forensique (extension metadata transition).
  await logPaymentEvent({
    eventType: "stripe_dispute",
    metadata: {
      dispute_id: dispute.id,
      order_id: orderId,
      stripe_status: stripeStatus,
      dispute_status: mappedStatus,
      transition: "updated",
      requires_action: mappedStatus === "warning_needs_response",
      matched,
    },
  });

  return { result: matched ? "updated" : "not_found" };
}
