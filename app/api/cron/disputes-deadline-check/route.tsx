import { NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/cron/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dbErrorResponse } from "@/lib/api/db-error-response";
import { sendTemplate } from "@/lib/resend/send";
import { sendSms } from "@/lib/twilio/sms";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";
import { SUPPORT_EMAIL } from "@/lib/env/support-email";
import AdminDisputeDeadlineWarning, {
  subject as deadlineWarningSubject,
} from "@/lib/resend/templates/admin-dispute-deadline-warning";

// Audit Stripe M-4 (2026-05-05) — cron quotidien 8h UTC :
//   - SELECT disputes WHERE status='needs_response' AND evidence_due_by
//     dans 24h–72h → email "Rappel" admin.
//   - SELECT disputes WHERE status='needs_response' AND evidence_due_by
//     dans <24h → email "URGENT 24h" admin + SMS Twilio si TWILIO_ADMIN_PHONE
//     configuré.
//   - SELECT disputes WHERE status='needs_response' AND evidence_due_by
//     déjà passée → audit log forensique stripe_dispute_deadline_missed.
//
// Read-only sur Stripe (pas d'effet de bord côté Stripe). Toute action
// d'evidence reste manuelle Dashboard Stripe — ce cron est un signal admin,
// pas une réponse automatique.
//
// Logs préfixés grep-able : [DISPUTES_DEADLINE_*].

export const maxDuration = 60;

const HOUR_MS = 60 * 60 * 1000;

type DisputeRow = {
  id: string;
  stripe_dispute_id: string;
  order_id: string;
  amount: number;
  currency: string;
  reason: string | null;
  evidence_due_by: string | null;
  metadata: Record<string, unknown> | null;
};

type Bucket = "urgent" | "soon" | "missed";

interface ProcessedItem {
  dispute_id: string;
  bucket: Bucket;
  email_sent: boolean;
  sms_sent: boolean;
  hours_remaining: number;
}

export async function POST(request: Request) {
  const authError = assertCronAuth(request);
  if (authError) return authError;

  const admin = createSupabaseAdminClient();
  const now = Date.now();
  const cutoffMissed = new Date(now).toISOString();
  const cutoffSoon = new Date(now + 72 * HOUR_MS).toISOString();

  // SELECT all open disputes with deadline <= now+72h. Filtrage local en
  // 3 buckets (missed / urgent / soon) pour éviter 3 round-trips DB.
  const { data: disputes, error } = await admin
    .from("disputes")
    .select(
      "id, stripe_dispute_id, order_id, amount, currency, reason, evidence_due_by, metadata",
    )
    .eq("status", "needs_response")
    .not("evidence_due_by", "is", null)
    .lte("evidence_due_by", cutoffSoon);

  if (error) {
    return dbErrorResponse(error, "CRON_DISPUTES_DEADLINE_SELECT_ERR");
  }

  if (!disputes || disputes.length === 0) {
    return NextResponse.json({ processed: 0, items: [] });
  }

  const items: ProcessedItem[] = [];

  for (const dispute of disputes as DisputeRow[]) {
    if (!dispute.evidence_due_by) continue;
    const dueByMs = new Date(dispute.evidence_due_by).getTime();
    const diffMs = dueByMs - now;
    const hoursRemaining = Math.round(diffMs / HOUR_MS);

    let bucket: Bucket;
    if (dueByMs < now) bucket = "missed";
    else if (diffMs <= 24 * HOUR_MS) bucket = "urgent";
    else bucket = "soon";

    if (bucket === "missed") {
      console.warn(
        `[DISPUTES_DEADLINE_MISSED] dispute=${dispute.stripe_dispute_id} order=${dispute.order_id} due=${dispute.evidence_due_by}`,
      );
      await logPaymentEvent({
        eventType: "stripe_dispute_deadline_missed",
        metadata: {
          dispute_id: dispute.stripe_dispute_id,
          order_id: dispute.order_id,
          evidence_due_by: dispute.evidence_due_by,
          hours_overdue: -hoursRemaining,
        },
      });
      items.push({
        dispute_id: dispute.stripe_dispute_id,
        bucket,
        email_sent: false,
        sms_sent: false,
        hours_remaining: hoursRemaining,
      });
      continue;
    }

    // Lookup code_commande via order_id pour humaniser l'email.
    const { data: order } = await admin
      .from("orders")
      .select("code_commande")
      .eq("id", dispute.order_id)
      .maybeSingle();
    const codeCommande =
      (order as { code_commande: string | null } | null)?.code_commande ??
      null;

    const evidenceDueByHuman = dispute.evidence_due_by.slice(0, 10);
    const dashboardUrl = `https://dashboard.stripe.com/disputes/${dispute.stripe_dispute_id}`;
    const props = {
      codeCommande,
      amount: Number(dispute.amount),
      currency: dispute.currency,
      reason: dispute.reason,
      evidenceDueBy: evidenceDueByHuman,
      hoursRemaining,
      disputeId: dispute.stripe_dispute_id,
      dashboardUrl,
      urgency: bucket,
    } as const;

    const emailRes = await sendTemplate({
      to: SUPPORT_EMAIL,
      userId: null,
      template: "admin_dispute_deadline_warning",
      subject: deadlineWarningSubject(props),
      element: <AdminDisputeDeadlineWarning {...props} />,
      metadata: {
        dispute_id: dispute.stripe_dispute_id,
        order_id: dispute.order_id,
        urgency: bucket,
      },
    });
    const emailSent = emailRes.ok;

    let smsSent = false;
    const adminPhone = process.env.TWILIO_ADMIN_PHONE;
    if (bucket === "urgent" && adminPhone) {
      const body =
        `TerrOir URGENT : dispute Stripe ${dispute.stripe_dispute_id} — ` +
        `evidence due in ${hoursRemaining}h. Dashboard: ${dashboardUrl}`;
      const smsRes = await sendSms({
        to: adminPhone,
        userId: null,
        template: "admin_dispute_deadline_urgent",
        body,
        metadata: {
          dispute_id: dispute.stripe_dispute_id,
          order_id: dispute.order_id,
        },
      });
      smsSent = smsRes.ok;
    }

    await logPaymentEvent({
      eventType: "stripe_dispute_deadline_warning",
      metadata: {
        dispute_id: dispute.stripe_dispute_id,
        order_id: dispute.order_id,
        evidence_due_by: dispute.evidence_due_by,
        hours_remaining: hoursRemaining,
        urgency: bucket,
        email_sent: emailSent,
        sms_sent: smsSent,
      },
    });

    console.warn(
      `[DISPUTES_DEADLINE_WARNING] dispute=${dispute.stripe_dispute_id} order=${dispute.order_id} bucket=${bucket} hours=${hoursRemaining} email=${emailSent} sms=${smsSent}`,
    );

    items.push({
      dispute_id: dispute.stripe_dispute_id,
      bucket,
      email_sent: emailSent,
      sms_sent: smsSent,
      hours_remaining: hoursRemaining,
    });
  }

  return NextResponse.json({ processed: items.length, items });
}

export const GET = POST;
