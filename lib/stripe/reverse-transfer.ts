import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { stripe } from "./server";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";
import { eurosToCents } from "@/lib/money/cents";

// =============================================================================
// F-004 (audit pré-launch 2026-05-10) — clawback proportionnel sur dispute
// lost / refund post-completion / EFW post-payout
// =============================================================================
//
// Architecture Stripe Connect TerrOir = Separate Charges & Transfers :
// les Transfers hebdo (cron weekly-payout) vers comptes Connect des producers
// sont INDÉPENDANTS des refunds/disputes ultérieurs sur les charges
// originales. Si une order completed (transfer payouté) tombe en dispute lost
// OU refund post-completion → TerrOir absorbe 100% perte commerciale (le
// producer a déjà encaissé son net 94%, TerrOir paie 100% de remboursement).
//
// reverseTransferIfNeeded :
//   1. Lookup order.transfer_id (renseigné par le cron weekly-payout via
//      markOrdersTransferred — cf. lib/stripe/payouts.tsx).
//   2. Si transfer_id IS NULL → noop (refund pre-completion, pas encore
//      payouté, le Transfer n'existe pas).
//   3. Si transfer_id renseigné → stripe.transfers.createReversal avec amount
//      en cents. Le reversal récupère le montant côté Connect account du
//      producer et le re-crédite sur la platform balance TerrOir.
//   4. Audit log forensique stripe_transfer_reversed avec metadata complet.
//
// Fail-safe : ne throw PAS si lookup DB échoue ou si Stripe API throw. Les
// callers (refund routes, dispute handler) ne doivent pas voir leur flow
// principal interrompu par un échec de clawback. Le drift est traçable via
// le log greppable [TRANSFER_REVERSAL_FAILED] + audit log dédié.
//
// =============================================================================

export type ReverseTransferSource =
  | "refund_admin"
  | "refund_producer"
  | "refund_cancel"
  | "refund_timeout"
  | "refund_revival_blocked"
  | "refund_efw"
  | "refund_retry"
  | "dispute_lost";

export type ReverseTransferResult =
  | { kind: "noop_no_transfer_id"; transferId: null }
  | { kind: "noop_lookup_failed"; transferId: null; error: string }
  | { kind: "reversed"; transferId: string; reversalId: string }
  | { kind: "failed"; transferId: string; error: string };

interface ReverseTransferParams {
  admin: SupabaseClient;
  orderId: string;
  amountEur: number;
  source: ReverseTransferSource;
  // Idempotency suffixe pour distinguer plusieurs tentatives sur la même
  // order (ex: refund partiel × 2). Si non fourni, défaut au source.
  idempotencyHint?: string;
}

export async function reverseTransferIfNeeded(
  params: ReverseTransferParams,
): Promise<ReverseTransferResult> {
  const { admin, orderId, amountEur, source } = params;

  // 1. Lookup transfer_id sur l'order. Une seule query, pas de join — la
  //    colonne est un text simple sans FK.
  const { data: order, error: lookupError } = await admin
    .from("orders")
    .select("id, transfer_id, producer_id")
    .eq("id", orderId)
    .maybeSingle();

  if (lookupError) {
    console.warn(
      `[TRANSFER_REVERSAL_LOOKUP_FAILED] order=${orderId} source=${source} reason=${lookupError.message}`,
    );
    return {
      kind: "noop_lookup_failed",
      transferId: null,
      error: lookupError.message,
    };
  }

  const transferId = (order as { transfer_id?: string | null } | null)
    ?.transfer_id;
  const producerId = (order as { producer_id?: string | null } | null)
    ?.producer_id;

  if (!transferId) {
    // Order pre-completion (pending/confirmed/cancelled) — pas encore
    // aggrégée en payout. Pas de reversal nécessaire, le Transfer n'a pas
    // eu lieu. Refund Stripe seul suffit (pas de double facturation
    // côté Connect account producer).
    return { kind: "noop_no_transfer_id", transferId: null };
  }

  // 2. Reversal Stripe. Idempotency-key dérivée de orderId+source pour
  //    qu'une 2e invocation du même path sur la même order renvoie le
  //    Reversal existant (pas de double-clawback côté Connect account).
  const amountCents = eurosToCents(amountEur);
  const idempotencyKey = `reversal_${orderId}_${
    params.idempotencyHint ?? source
  }`;

  try {
    const reversal = await stripe.transfers.createReversal(
      transferId,
      {
        amount: amountCents,
        metadata: {
          order_id: orderId,
          producer_id: producerId ?? "",
          source,
        },
      },
      { idempotencyKey },
    );

    console.log(
      `[TRANSFER_REVERSED] order=${orderId} transfer=${transferId} reversal=${reversal.id} amount_cents=${amountCents} source=${source}`,
    );

    await logPaymentEvent({
      eventType: "stripe_transfer_reversed",
      metadata: {
        order_id: orderId,
        producer_id: producerId,
        transfer_id: transferId,
        reversal_id: reversal.id,
        amount_cents: amountCents,
        currency: "eur",
        source,
      },
    });

    return {
      kind: "reversed",
      transferId,
      reversalId: reversal.id,
    };
  } catch (err) {
    const msg = (err as Error).message;
    console.error(
      `[TRANSFER_REVERSAL_FAILED] order=${orderId} transfer=${transferId} source=${source} error=${msg}`,
    );

    await logPaymentEvent({
      eventType: "stripe_transfer_reversal_failed",
      metadata: {
        order_id: orderId,
        producer_id: producerId,
        transfer_id: transferId,
        amount_cents: amountCents,
        currency: "eur",
        source,
        error_message: msg,
      },
    }).catch(() => {});

    return {
      kind: "failed",
      transferId,
      error: msg,
    };
  }
}
