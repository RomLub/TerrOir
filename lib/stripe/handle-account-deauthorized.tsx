import type { SupabaseClient } from "@supabase/supabase-js";
import { waitUntil } from "@vercel/functions";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";
import { sendTemplate } from "@/lib/resend/send";
import { SUPPORT_EMAIL } from "@/lib/env/support-email";
import AdminAccountDeauthorized, {
  subject as adminAccountDeauthorizedSubject,
} from "@/lib/resend/templates/admin-account-deauthorized";

// Audit Stripe phase 2 M-3 (2026-05-05) — handler webhook
// `account.application.deauthorized`. Producer disconnecte son Connect
// account depuis Dashboard Stripe (rare mais possible : perte de confiance,
// bug, switch plateforme). Sans handler, producers.stripe_account_id reste
// figé en DB et le prochain transfer Stripe va échouer en account_invalid.
//
// IMPORTANT contrat Stripe : sur cet event, `event.data.object` est en
// réalité un `Stripe.Application` (l'app OAuth/Connect côté plateforme),
// PAS un Account. Le Connect account déauthorisé est référencé via
// `event.account` (Connect-stamped account header). C'est la raison pour
// laquelle la signature de ce handler prend `eventAccount: string | null`
// en argument séparé plutôt que de caster event.data.object as Account.
//
// Sémantique :
//   1. Lookup producer via stripe_account_id (event.account).
//   2. UPDATE producers : reset les 4 flags Stripe + statut='suspended'.
//      Décision statut : enum supporté (draft, pending, active, public,
//      suspended) — 'suspended' correspond exactement à l'état "Connect
//      désautorisé, ne peut plus recevoir de paiements". Admin peut
//      ré-onboarder le producer en repassant via /api/stripe/connect/onboard.
//   3. Audit log forensique stripe_account_deauthorized.
//   4. INSERT notifications placeholder admin (template='admin_account_deauthorized').
//   5. waitUntil(sendTemplate(... admin URGENT)).
//
// Logs préfixés grep-able : [STRIPE_ACCOUNT_DEAUTHORIZED],
// [STRIPE_ACCOUNT_DEAUTHORIZED_NO_PRODUCER].

export type AccountDeauthorizedResult = "deauthorized" | "no_producer_match";

export async function syncStripeAccountDeauthorized(
  application: { id: string; object: string } | null,
  eventAccount: string | null,
  admin: SupabaseClient,
): Promise<{ result: AccountDeauthorizedResult; producerId: string | null }> {
  const applicationId = application?.id ?? null;

  if (!eventAccount) {
    console.warn(
      `[STRIPE_ACCOUNT_DEAUTHORIZED_NO_ACCOUNT] application=${applicationId ?? "null"} — event.account manquant, skip`,
    );
    await logPaymentEvent({
      eventType: "stripe_account_deauthorized",
      metadata: {
        application_id: applicationId,
        stripe_account_id: null,
        producer_match: false,
      },
    });
    return { result: "no_producer_match", producerId: null };
  }

  // 1. Lookup producer.
  const { data: producer } = await admin
    .from("producers")
    .select("id, nom_exploitation, user_id")
    .eq("stripe_account_id", eventAccount)
    .maybeSingle();

  let producerId: string | null = null;
  let exploitation: string | null = null;
  if (producer) {
    const row = producer as {
      id: string;
      nom_exploitation: string | null;
      user_id: string | null;
    };
    producerId = row.id;
    exploitation = row.nom_exploitation;
  }

  if (!producerId) {
    console.warn(
      `[STRIPE_ACCOUNT_DEAUTHORIZED_NO_PRODUCER] account=${eventAccount} application=${applicationId ?? "null"} — producer introuvable`,
    );
    await logPaymentEvent({
      eventType: "stripe_account_deauthorized",
      metadata: {
        application_id: applicationId,
        stripe_account_id: eventAccount,
        producer_match: false,
      },
    });
    return { result: "no_producer_match", producerId: null };
  }

  // 2. Reset flags + statut='suspended'. stripe_account_id mis à null pour
  // empêcher tout transfer futur (account.updated webhook serait sans match
  // si le producer ré-onboarde plus tard avec un nouveau acct_*). Producer
  // ré-onboardable via /api/stripe/connect/onboard (création nouvelle acct_*).
  const { error: updateError } = await admin
    .from("producers")
    .update({
      stripe_account_id: null,
      stripe_charges_enabled: false,
      stripe_payouts_enabled: false,
      stripe_details_submitted: false,
      statut: "suspended",
    })
    .eq("id", producerId);

  if (updateError) {
    console.error(
      `[STRIPE_ACCOUNT_DEAUTHORIZED_UPDATE_ERR] producer=${producerId} account=${eventAccount} error=${(updateError as { message?: string }).message ?? "unknown"}`,
    );
    // On continue : audit log + email doivent partir même si UPDATE a
    // échoué (visibilité admin > intégrité transitoire). Drift potentiel
    // récupérable via Dashboard Stripe.
  }

  console.error(
    `[STRIPE_ACCOUNT_DEAUTHORIZED] producer=${producerId} account=${eventAccount} application=${applicationId} — flags reset + statut=suspended`,
  );

  // 3. Audit log forensique.
  await logPaymentEvent({
    eventType: "stripe_account_deauthorized",
    metadata: {
      application_id: applicationId,
      stripe_account_id: eventAccount,
      producer_id: producerId,
      producer_match: true,
    },
  });

  // 4. Notification placeholder DB.
  await admin.from("notifications").insert({
    user_id: null,
    type: "email",
    template: "admin_account_deauthorized",
    statut: "sent",
    metadata: {
      producer_id: producerId,
      stripe_account_id: eventAccount,
      application_id: applicationId,
    },
  });

  // 5. Email URGENT admin.
  const dashboardUrl = `https://dashboard.stripe.com/connect/accounts/${eventAccount}`;
  const props = {
    exploitation,
    producerId,
    stripeAccountId: eventAccount,
    dashboardUrl,
  };
  waitUntil(
    sendTemplate({
      to: SUPPORT_EMAIL,
      userId: null,
      template: "admin_account_deauthorized",
      subject: adminAccountDeauthorizedSubject(props),
      element: <AdminAccountDeauthorized {...props} />,
      metadata: {
        producer_id: producerId,
        stripe_account_id: eventAccount,
      },
    }).catch((err) => {
      console.error(
        `[STRIPE_ACCOUNT_DEAUTHORIZED_EMAIL_ERR] producer=${producerId} account=${eventAccount} error=${(err as Error).message}`,
      );
    }),
  );

  return { result: "deauthorized", producerId };
}
