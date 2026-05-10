import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe/server";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";
import { sendOpsAlert } from "@/lib/ops/alert";
import { classifyRefundError } from "@/lib/refund-incidents/classify-error";
import { recordRefundAttempt } from "@/lib/refund-incidents/record-refund-attempt";
import { revalidatePublicStats } from "@/lib/stats/revalidate";
import { reverseTransferIfNeeded } from "@/lib/stripe/reverse-transfer";
import {
  InvalidOrderTransitionError,
  assertTransition,
  type OrderStatus,
} from "@/lib/orders/stateMachine";

// F-014 v2 (audit P0 sweep 2026-05-11) — Helper extrait du route handler
// /api/stripe/refund pour permettre la réutilisation depuis le flow admin
// approve d'un pending_refund. Séquence reversal → refund Stripe → RPC
// cancel_order → revalidate cache → audit log → notification consumer,
// identique au path historique mais factorisé.
//
// Le caller décide :
//   • emittedBy : 'admin' | 'producer' | 'admin_approved_pending'
//     (utilisé pour discriminer audit event_type et message d'erreur).
//   • idempotencyKey : key Stripe (collision-safe par order_id + path).

export type ExecuteRefundInput = {
  admin: SupabaseClient;
  order: {
    id: string;
    consumer_id: string | null;
    producer_id: string | null;
    statut: string;
    stripe_payment_intent_id: string | null;
    montant_total: number | string;
    code_commande: string | null;
  };
  emittedBy: "admin" | "producer" | "admin_approved_pending";
  idempotencyKey: string;
};

export type ExecuteRefundResult =
  | { kind: "success"; refundId: string; warning?: string }
  | { kind: "already_refunded" }
  | { kind: "no_payment_intent" }
  | { kind: "invalid_transition"; message: string }
  | { kind: "reversal_failed"; transferId: string }
  | { kind: "stripe_failed"; error: Error };

export async function executeRefundFlow(
  input: ExecuteRefundInput,
): Promise<ExecuteRefundResult> {
  const { admin, order, emittedBy, idempotencyKey } = input;

  if (order.statut === "refunded") {
    return { kind: "already_refunded" };
  }
  if (!order.stripe_payment_intent_id) {
    return { kind: "no_payment_intent" };
  }

  try {
    assertTransition(order.statut as OrderStatus, "refunded");
  } catch (e) {
    if (e instanceof InvalidOrderTransitionError) {
      return { kind: "invalid_transition", message: e.message };
    }
    throw e;
  }

  const source =
    emittedBy === "producer"
      ? "refund_producer"
      : emittedBy === "admin_approved_pending"
        ? "refund_admin_approved_pending"
        : "refund_admin";

  const reversal = await reverseTransferIfNeeded({
    admin,
    orderId: order.id,
    amountEur: Number(order.montant_total),
    source,
  });
  if (reversal.kind === "failed") {
    await sendOpsAlert(
      "[TRANSFER_REVERSAL_BLOCKED_REFUND]",
      new Error(reversal.error),
      {
        order_id: order.id,
        transfer_id: reversal.transferId,
        producer_id: order.producer_id,
        path: source,
        amount: Number(order.montant_total),
      },
    );
    return { kind: "reversal_failed", transferId: reversal.transferId };
  }

  let refund;
  try {
    refund = await stripe.refunds.create(
      { payment_intent: order.stripe_payment_intent_id },
      { idempotencyKey },
    );
  } catch (e) {
    const classified = classifyRefundError(e);
    await recordRefundAttempt({
      orderId: order.id,
      kind: emittedBy === "producer" ? "manual_cancel" : "admin",
      paymentIntentId: order.stripe_payment_intent_id,
      consumerId: order.consumer_id,
      blockedReason: null,
      outcome: "failed",
      classified,
    });
    await logPaymentEvent({
      eventType:
        emittedBy === "producer"
          ? "order_producer_refund_failed"
          : "order_admin_refund_failed",
      userId: order.consumer_id,
      metadata: {
        order_id: order.id,
        producer_id: order.producer_id,
        payment_intent_id: order.stripe_payment_intent_id,
        refund_error: (e as Error).message,
        emitted_by: emittedBy,
      },
    });
    return { kind: "stripe_failed", error: e as Error };
  }

  const { error: rpcError } = await admin.rpc("cancel_order", {
    p_order_id: order.id,
    p_reason: "admin_refund",
    p_target_status: "refunded",
  });

  if (rpcError) {
    await sendOpsAlert("[REFUND_DB_DRIFT]", new Error(rpcError.message), {
      order_id: order.id,
      refund_id: refund.id,
      path: source,
      db_error: rpcError.message,
      rpc_code: rpcError.code ?? "none",
    });
    return {
      kind: "success",
      refundId: refund.id,
      warning: `[REFUND_DB_DRIFT] order=${order.id} refund_id=${refund.id} ${rpcError.message}`,
    };
  }

  await revalidatePublicStats({ source: "stripe-refund", orderId: order.id });

  await logPaymentEvent({
    eventType:
      emittedBy === "producer"
        ? "order_producer_refund_succeeded"
        : "order_admin_refund_succeeded",
    userId: order.consumer_id,
    metadata: {
      order_id: order.id,
      producer_id: order.producer_id,
      payment_intent_id: order.stripe_payment_intent_id,
      refund_id: refund.id,
      amount: Number(order.montant_total),
      emitted_by: emittedBy,
    },
  }).catch(() => {});

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

  return { kind: "success", refundId: refund.id };
}
