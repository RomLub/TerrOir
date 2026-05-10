import { NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/cron/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";
import { sendTemplate } from "@/lib/resend/send";
import { SUPPORT_EMAIL } from "@/lib/env/support-email";
import ProducerRefundPendingDecision, {
  subject as producerRefundDecisionSubject,
} from "@/lib/resend/templates/producer-refund-pending-decision";
import { dbErrorResponse } from "@/lib/api/db-error-response";

// F-014 v2 (audit P0 sweep 2026-05-11) — Cron daily : auto-expire les
// pending_refunds non décidés sous 7 jours. Émet email producer +
// notification admin pour signal que sa demande a été clôturée.
//
// Auth Bearer CRON_SECRET (lib/cron/auth.ts).

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export async function POST(request: Request) {
  const authError = assertCronAuth(request);
  if (authError) return authError;

  const admin = createSupabaseAdminClient();
  const cutoff = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();

  // Récupère les pending non décidés depuis > 7j.
  const { data: candidates, error: fetchErr } = await admin
    .from("pending_refunds")
    .select(
      `id, order_id, producer_id, amount_eur, reason, requested_at,
       order:order_id ( code_commande ),
       producer:producer_id ( user_id )`,
    )
    .eq("status", "pending")
    .lt("requested_at", cutoff)
    .limit(50);

  if (fetchErr) {
    return dbErrorResponse(fetchErr, "CRON_REFUND_EXPIRE_PENDING_FETCH");
  }

  if (!candidates || candidates.length === 0) {
    return NextResponse.json({ ok: true, expired: 0 });
  }

  let expired = 0;
  const errors: string[] = [];

  for (const row of candidates) {
    // Atomic guard status='pending' AND requested_at < cutoff (race avec
    // approve/deny concurrent côté admin).
    const { data: updated, error: updateErr } = await admin
      .from("pending_refunds")
      .update({
        status: "expired",
        decided_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (updateErr) {
      console.error(
        `[REFUND_EXPIRE_PENDING_UPDATE_ERR] id=${row.id} error=${updateErr.message}`,
      );
      errors.push(row.id);
      continue;
    }
    if (!updated) {
      // Already decided by admin between fetch and update — skip.
      continue;
    }

    expired += 1;

    await logPaymentEvent({
      eventType: "producer_refund_pending_expired",
      userId: null,
      metadata: {
        pending_refund_id: row.id,
        order_id: row.order_id,
        producer_id: row.producer_id,
        amount: Number(row.amount_eur),
        requested_at: row.requested_at,
      },
    }).catch(() => {});

    // Email producer.
    const producer = Array.isArray(row.producer) ? row.producer[0] : row.producer;
    const order = Array.isArray(row.order) ? row.order[0] : row.order;
    if (producer?.user_id) {
      const { data: userRow } = await admin
        .from("users")
        .select("email")
        .eq("id", producer.user_id)
        .maybeSingle();
      const producerEmail = (userRow?.email as string | null) ?? null;
      if (producerEmail) {
        const props = {
          decision: "expired" as const,
          codeCommande: (order?.code_commande as string | null) ?? null,
          amount: Number(row.amount_eur),
          orderId: row.order_id,
          decisionReason: "Aucune décision admin sous 7 jours.",
        };
        await sendTemplate({
          to: producerEmail,
          userId: producer.user_id,
          template: "producer_refund_pending_decision",
          subject: producerRefundDecisionSubject(props),
          element: <ProducerRefundPendingDecision {...props} />,
          metadata: {
            pending_refund_id: row.id,
            order_id: row.order_id,
            producer_id: row.producer_id,
            decision: "expired",
          },
        }).catch((err) => {
          console.error(
            `[REFUND_EXPIRE_PENDING_EMAIL_ERR] id=${row.id} error=${(err as Error).message}`,
          );
        });
      }
    }

    // Email admin (digest minimal).
    await sendTemplate({
      to: SUPPORT_EMAIL,
      userId: null,
      template: "admin_refund_pending_expired",
      subject: `[TerrOir Admin] Refund pending expiré (7j) — ${row.order_id.slice(0, 8)}`,
      element: (
        <div>
          <p>
            Un pending_refund a expiré sans décision admin (7 jours écoulés).
          </p>
          <p>Producer ID: {row.producer_id}</p>
          <p>Order ID: {row.order_id}</p>
          <p>Montant: {Number(row.amount_eur).toFixed(2)}€</p>
        </div>
      ),
      metadata: {
        pending_refund_id: row.id,
        order_id: row.order_id,
        producer_id: row.producer_id,
      },
    }).catch((err) => {
      console.error(
        `[REFUND_EXPIRE_PENDING_ADMIN_EMAIL_ERR] id=${row.id} error=${(err as Error).message}`,
      );
    });
  }

  return NextResponse.json({
    ok: true,
    expired,
    errors: errors.length,
  });
}
