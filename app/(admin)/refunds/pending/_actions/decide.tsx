"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { waitUntil } from "@vercel/functions";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";
import { sendTemplate } from "@/lib/resend/send";
import ProducerRefundPendingDecision, {
  subject as producerRefundDecisionSubject,
} from "@/lib/resend/templates/producer-refund-pending-decision";
import { executeRefundFlow } from "@/lib/refunds/execute-refund";

// F-014 v2 (audit P0 sweep 2026-05-11) — Server actions admin pour
// trancher les pending_refunds. Le caller (admin UI) appelle approve()
// ou deny() avec l'id du pending_refund et un optionnel decision_reason.
//
// Idempotence : le status guard (UPDATE WHERE status='pending') empêche
// la double-approval / double-denial. Si déjà décidé, retourne ok=false
// avec reason='already_decided'.

const inputSchema = z.object({
  pendingRefundId: z.string().uuid(),
  decisionReason: z.string().max(1000).optional(),
});

export type DecideRefundResult =
  | { ok: true; decision: "approved" | "denied"; refundId?: string }
  | { ok: false; reason: string };

async function decide(
  formData: FormData,
  decision: "approved" | "denied",
): Promise<DecideRefundResult> {
  const session = await getSessionUser();
  if (!session?.isAdmin) {
    return { ok: false, reason: "forbidden" };
  }

  const parsed = inputSchema.safeParse({
    pendingRefundId: formData.get("pendingRefundId"),
    decisionReason: formData.get("decisionReason") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, reason: "invalid_input" };
  }

  const admin = createSupabaseAdminClient();

  // Atomic status guard : UPDATE WHERE status='pending'. Race-safe vs double-
  // click admin ou approve/deny concurrents.
  const { data: updated, error: updateErr } = await admin
    .from("pending_refunds")
    .update({
      status: decision,
      decided_at: new Date().toISOString(),
      decided_by: session.id,
      decision_reason: parsed.data.decisionReason ?? null,
    })
    .eq("id", parsed.data.pendingRefundId)
    .eq("status", "pending")
    .select("id, order_id, producer_id, amount_eur, reason")
    .maybeSingle();

  if (updateErr) {
    console.error(
      `[PENDING_REFUND_DECIDE_ERR] id=${parsed.data.pendingRefundId} decision=${decision} error=${updateErr.message}`,
    );
    return { ok: false, reason: "database_error" };
  }

  if (!updated) {
    return { ok: false, reason: "already_decided" };
  }

  // Audit log distinct par décision.
  await logPaymentEvent({
    eventType:
      decision === "approved"
        ? "producer_refund_admin_approved"
        : "producer_refund_admin_denied",
    userId: session.id,
    metadata: {
      pending_refund_id: updated.id,
      order_id: updated.order_id,
      producer_id: updated.producer_id,
      amount: Number(updated.amount_eur),
      decided_by: session.id,
      decision_reason: parsed.data.decisionReason ?? null,
    },
  }).catch(() => {});

  let executedRefundId: string | undefined;
  let executionError: string | undefined;

  if (decision === "approved") {
    // Fetch order pour exécuter le refund flow.
    const { data: order, error: orderErr } = await admin
      .from("orders")
      .select(
        "id, consumer_id, producer_id, statut, stripe_payment_intent_id, montant_total, code_commande",
      )
      .eq("id", updated.order_id)
      .maybeSingle();

    if (orderErr || !order) {
      console.error(
        `[PENDING_REFUND_ORDER_LOOKUP_ERR] pending=${updated.id} order=${updated.order_id} error=${orderErr?.message ?? "no_row"}`,
      );
      executionError = "order_lookup_failed";
    } else {
      const result = await executeRefundFlow({
        admin,
        order,
        emittedBy: "admin_approved_pending",
        idempotencyKey: `pending_refund_${updated.id}`,
      });
      if (result.kind === "success") {
        executedRefundId = result.refundId;
      } else {
        executionError = result.kind;
        console.error(
          `[PENDING_REFUND_EXECUTE_ERR] pending=${updated.id} kind=${result.kind}`,
        );
      }
    }
  }

  // Lookup producer email pour notification (fail-open).
  const { data: producerRow } = await admin
    .from("producers")
    .select("user_id, nom_exploitation")
    .eq("id", updated.producer_id)
    .maybeSingle();

  let producerEmail: string | null = null;
  if (producerRow?.user_id) {
    const { data: userRow } = await admin
      .from("users")
      .select("email")
      .eq("id", producerRow.user_id)
      .maybeSingle();
    producerEmail = (userRow?.email as string | null) ?? null;
  }

  if (producerEmail) {
    const props = {
      decision,
      codeCommande: null as string | null,
      amount: Number(updated.amount_eur),
      orderId: updated.order_id,
      decisionReason: parsed.data.decisionReason ?? null,
    };

    // Fetch code_commande for email subject if needed (not strictly required).
    const { data: orderCode } = await admin
      .from("orders")
      .select("code_commande")
      .eq("id", updated.order_id)
      .maybeSingle();
    props.codeCommande = (orderCode?.code_commande as string | null) ?? null;

    waitUntil(
      sendTemplate({
        to: producerEmail,
        userId: producerRow?.user_id ?? null,
        template: "producer_refund_pending_decision",
        subject: producerRefundDecisionSubject(props),
        element: <ProducerRefundPendingDecision {...props} />,
        metadata: {
          pending_refund_id: updated.id,
          order_id: updated.order_id,
          producer_id: updated.producer_id,
          decision,
        },
      }).catch((err) => {
        console.error(
          `[PRODUCER_REFUND_DECISION_EMAIL_ERR] pending=${updated.id} decision=${decision} error=${(err as Error).message}`,
        );
      }),
    );
  }

  revalidatePath("/refunds/pending");

  if (executionError) {
    return { ok: false, reason: `execute_failed:${executionError}` };
  }
  return { ok: true, decision, refundId: executedRefundId };
}

export async function approvePendingRefund(
  formData: FormData,
): Promise<DecideRefundResult> {
  return decide(formData, "approved");
}

export async function denyPendingRefund(
  formData: FormData,
): Promise<DecideRefundResult> {
  return decide(formData, "denied");
}
