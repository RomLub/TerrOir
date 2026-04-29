import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { waitUntil } from "@vercel/functions";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";
import { sendTemplate } from "@/lib/resend/send";
import { SUPPORT_EMAIL } from "@/lib/env/support-email";
import AdminTransferFailed, {
  subject as adminTransferFailedSubject,
} from "@/lib/resend/templates/admin-transfer-failed";

// Extrait du handler webhook `transfer.failed` (cf app/api/stripe/webhook/route.tsx).
// Stripe émet cet event quand un Transfer plateforme -> Connect account
// échoue (KYC compte incomplet, plafonds, banque destination KO). Stripe
// ne re-tente PAS automatiquement — action admin requise.
//
// Sémantique :
//   1. UPDATE payouts SET statut='failed' WHERE stripe_transfer_id=transfer.id
//      (CHECK enum élargi par migration 20260429010000 T-422). Si aucune row
//      matchée -> log warn + return 'no_match' (orphelin DB ou Transfer
//      hors flow weekly payouts).
//   2. Audit log forensique stripe_transfer_failed avec metadata complète
//      (transfer_id, producer_id, amount, failure_message, failure_code).
//   3. INSERT notifications placeholder admin (template='admin_transfer_failed',
//      user_id=null, statut='sent') — traçabilité DB pour UI admin future.
//   4. waitUntil(sendTemplate(...)) email réel admin via SUPPORT_EMAIL.
//      Pattern dual cohérent décision PUSH 1 question B.
//
// Logs préfixés grep-able : [STRIPE_TRANSFER_FAILED]. Pattern thin wrapper
// aligné lib/stripe/handle-payment-failed.ts.

export type TransferFailedResult = "updated" | "no_match";

interface TransferWithFailure extends Stripe.Transfer {
  // Stripe.Transfer dans @types/stripe v17 ne typifie pas explicitement
  // failure_code/failure_message. Selon la version d'API et le contexte
  // d'échec, ces champs peuvent apparaître côté payload — on les lit en
  // optionnel pour les logger sans assumer leur présence.
  failure_code?: string | null;
  failure_message?: string | null;
}

export async function syncStripeTransferFailed(
  transfer: Stripe.Transfer,
  admin: SupabaseClient,
): Promise<{ result: TransferFailedResult; producerId: string | null }> {
  const t = transfer as TransferWithFailure;
  const failureCode = t.failure_code ?? null;
  const failureMessage = t.failure_message ?? null;

  // UPDATE payouts statut='failed'. select('id, producer_id') pour récupérer
  // le producer_id à logger / notifier (le metadata du Transfer contient
  // aussi producer_id, mais on prend la source DB authoritative).
  const { data: updatedRows, error: updateError } = await admin
    .from("payouts")
    .update({ statut: "failed" })
    .eq("stripe_transfer_id", transfer.id)
    .select("id, producer_id");

  if (updateError) {
    console.warn(
      `[STRIPE_TRANSFER_FAILED_UPDATE_ERR] transfer=${transfer.id} error=${(updateError as { message?: string }).message ?? "unknown"}`,
    );
  }

  const matched = Array.isArray(updatedRows) && updatedRows.length > 0;
  const producerId = matched
    ? String((updatedRows[0] as { producer_id: unknown }).producer_id ?? "") || null
    : (transfer.metadata?.producer_id ?? null);

  if (!matched) {
    console.warn(
      `[STRIPE_TRANSFER_FAILED_NO_MATCH] transfer=${transfer.id} producer_metadata=${producerId ?? "null"} amount=${transfer.amount} — payouts row introuvable`,
    );
  } else {
    console.error(
      `[STRIPE_TRANSFER_FAILED] transfer=${transfer.id} producer=${producerId} amount=${transfer.amount} code=${failureCode} message=${failureMessage}`,
    );
  }

  // Lookup producteur pour composer le sujet email + INSERT notification.
  let exploitation: string | null = null;
  if (producerId) {
    const { data: producer } = await admin
      .from("producers")
      .select("nom_exploitation")
      .eq("id", producerId)
      .maybeSingle();
    exploitation = (producer as { nom_exploitation?: string | null } | null)
      ?.nom_exploitation ?? null;
  }

  // Audit log forensique (fail-safe, ne re-throw pas).
  await logPaymentEvent({
    eventType: "stripe_transfer_failed",
    metadata: {
      transfer_id: transfer.id,
      producer_id: producerId,
      amount: transfer.amount,
      currency: transfer.currency,
      destination:
        typeof transfer.destination === "string"
          ? transfer.destination
          : (transfer.destination?.id ?? null),
      failure_code: failureCode,
      failure_message: failureMessage,
      matched,
    },
  });

  // Notification placeholder DB (audit interne, UI admin future).
  await admin.from("notifications").insert({
    user_id: null,
    type: "email",
    template: "admin_transfer_failed",
    statut: "sent",
    metadata: {
      transfer_id: transfer.id,
      producer_id: producerId,
      amount: transfer.amount,
      currency: transfer.currency,
      failure_code: failureCode,
      failure_message: failureMessage,
    },
  });

  // Email réel admin via SUPPORT_EMAIL — découplage waitUntil pour ack 200
  // immédiat côté Stripe (pattern cohérent avec les autres handlers webhook).
  const amountEuros = transfer.amount / 100;
  const dashboardUrl = `https://dashboard.stripe.com/connect/transfers/${transfer.id}`;
  const props = {
    exploitation,
    amount: amountEuros,
    currency: transfer.currency,
    transferId: transfer.id,
    failureMessage,
    failureCode,
    dashboardUrl,
  };
  waitUntil(
    sendTemplate({
      to: SUPPORT_EMAIL,
      userId: null,
      template: "admin_transfer_failed",
      subject: adminTransferFailedSubject(props),
      element: <AdminTransferFailed {...props} />,
      metadata: {
        transfer_id: transfer.id,
        producer_id: producerId,
      },
    }).catch((err) => {
      console.error(
        `[STRIPE_TRANSFER_FAILED_EMAIL_ERR] transfer=${transfer.id} error=${(err as Error).message}`,
      );
    }),
  );

  return {
    result: matched ? "updated" : "no_match",
    producerId,
  };
}
