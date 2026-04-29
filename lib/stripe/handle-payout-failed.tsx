import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { waitUntil } from "@vercel/functions";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";
import { sendTemplate } from "@/lib/resend/send";
import { SUPPORT_EMAIL } from "@/lib/env/support-email";
import AdminPayoutFailed, {
  subject as adminPayoutFailedSubject,
} from "@/lib/resend/templates/admin-payout-failed";

// Extrait du handler webhook `payout.failed` (cf app/api/stripe/webhook/route.tsx).
// Stripe émet cet event quand un Payout Connect account -> banque producteur
// échoue (RIB invalide, banque destination fermée, plafonds…). Stripe ne
// re-tente PAS automatiquement ce Payout — action admin requise.
//
// Sémantique :
//   1. Lookup payouts row pour passer statut='failed'. Sources possibles
//      du producer/payout match :
//        a) payout.metadata.payout_id (cas T-414 INSERT-before-transfer
//           futur) — direct sur l'id row.
//        b) FALLBACK event.account (Connect account id présent sur tous
//           les events Connect) -> producers.stripe_account_id ->
//           producer_id -> match payouts statut IN ('processing','paid')
//           des 30 derniers jours. Cf décision PUSH 1 question D
//           (correction du brief TD : la metadata Transfer ne propage
//           pas vers Payout).
//      Si aucun match -> log warn + return 'no_match'.
//   2. Audit log forensique stripe_payout_failed (metadata complète).
//   3. INSERT notifications placeholder admin (template='admin_payout_failed').
//   4. waitUntil(sendTemplate(...)) email réel admin via SUPPORT_EMAIL.
//
// Logs préfixés grep-able : [STRIPE_PAYOUT_FAILED], [STRIPE_PAYOUT_FAILED_NO_MATCH].

export type PayoutFailedResult = "updated" | "no_match";

// Lecture défensive de payout.metadata.payout_id (cas T-414 futur où on
// stamperait l'id row payouts directement). Stripe.Metadata = Record<string,
// string>, donc lookup via index access — pas d'extension d'interface.

export async function syncStripePayoutFailed(
  payout: Stripe.Payout,
  eventAccount: string | null,
  admin: SupabaseClient,
): Promise<{ result: PayoutFailedResult; producerId: string | null; payoutRowId: string | null }> {
  const failureCode = payout.failure_code ?? null;
  const failureMessage = payout.failure_message ?? null;

  // 1. Trouver le row payouts à mettre à jour.
  let payoutRowId: string | null = null;
  let producerId: string | null = null;

  // Source (a) : metadata.payout_id direct (cas T-414 futur)
  const metadataPayoutId = payout.metadata?.payout_id ?? null;
  if (metadataPayoutId) {
    const { data } = await admin
      .from("payouts")
      .select("id, producer_id")
      .eq("id", metadataPayoutId)
      .maybeSingle();
    if (data) {
      payoutRowId = String((data as { id: unknown }).id);
      producerId = String((data as { producer_id: unknown }).producer_id ?? "") || null;
    }
  }

  // Source (b) FALLBACK : event.account -> producers.stripe_account_id ->
  // payouts récents du producer (30 jours, statut processing/paid).
  if (!payoutRowId && eventAccount) {
    const { data: producer } = await admin
      .from("producers")
      .select("id")
      .eq("stripe_account_id", eventAccount)
      .maybeSingle();

    if (producer) {
      producerId = String((producer as { id: unknown }).id);
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: matched } = await admin
        .from("payouts")
        .select("id, producer_id")
        .eq("producer_id", producerId)
        .in("statut", ["processing", "paid"])
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (matched) {
        payoutRowId = String((matched as { id: unknown }).id);
      }
    }
  }

  if (!payoutRowId) {
    console.warn(
      `[STRIPE_PAYOUT_FAILED_NO_MATCH] payout=${payout.id} account=${eventAccount ?? "null"} amount=${payout.amount} — payouts row introuvable`,
    );
  } else {
    // UPDATE statut='failed' (CHECK enum élargi par migration T-422).
    const { error: updateError } = await admin
      .from("payouts")
      .update({ statut: "failed" })
      .eq("id", payoutRowId);
    if (updateError) {
      console.warn(
        `[STRIPE_PAYOUT_FAILED_UPDATE_ERR] payout=${payout.id} row=${payoutRowId} error=${(updateError as { message?: string }).message ?? "unknown"}`,
      );
    } else {
      console.error(
        `[STRIPE_PAYOUT_FAILED] payout=${payout.id} row=${payoutRowId} producer=${producerId} amount=${payout.amount} code=${failureCode} message=${failureMessage}`,
      );
    }
  }

  // Lookup producteur pour composer le sujet email.
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

  // Audit log forensique (fail-safe).
  await logPaymentEvent({
    eventType: "stripe_payout_failed",
    metadata: {
      payout_id: payout.id,
      payout_row_id: payoutRowId,
      producer_id: producerId,
      amount: payout.amount,
      currency: payout.currency,
      arrival_date: payout.arrival_date,
      destination:
        typeof payout.destination === "string"
          ? payout.destination
          : (payout.destination?.id ?? null),
      stripe_account: eventAccount,
      failure_code: failureCode,
      failure_message: failureMessage,
      matched: payoutRowId !== null,
    },
  });

  // Notification placeholder DB.
  await admin.from("notifications").insert({
    user_id: null,
    type: "email",
    template: "admin_payout_failed",
    statut: "sent",
    metadata: {
      payout_id: payout.id,
      payout_row_id: payoutRowId,
      producer_id: producerId,
      amount: payout.amount,
      currency: payout.currency,
      failure_code: failureCode,
      failure_message: failureMessage,
    },
  });

  // Email réel admin.
  const amountEuros = payout.amount / 100;
  const arrivalDate = payout.arrival_date
    ? new Date(payout.arrival_date * 1000).toISOString().slice(0, 10)
    : null;
  const dashboardUrl = `https://dashboard.stripe.com/connect/accounts/${eventAccount ?? ""}/payouts/${payout.id}`;
  const props = {
    exploitation,
    amount: amountEuros,
    currency: payout.currency,
    payoutId: payout.id,
    failureMessage,
    failureCode,
    arrivalDate,
    dashboardUrl,
  };
  waitUntil(
    sendTemplate({
      to: SUPPORT_EMAIL,
      userId: null,
      template: "admin_payout_failed",
      subject: adminPayoutFailedSubject(props),
      element: <AdminPayoutFailed {...props} />,
      metadata: {
        payout_id: payout.id,
        producer_id: producerId,
      },
    }).catch((err) => {
      console.error(
        `[STRIPE_PAYOUT_FAILED_EMAIL_ERR] payout=${payout.id} error=${(err as Error).message}`,
      );
    }),
  );

  return {
    result: payoutRowId ? "updated" : "no_match",
    producerId,
    payoutRowId,
  };
}
