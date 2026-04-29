import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";

// Extrait du handler webhook `payout.paid` (cf app/api/stripe/webhook/route.tsx).
// Stripe émet cet event quand un Payout Connect account -> banque producteur
// est effectivement réglé. Bundle 3 (T-402) a élargi la stratégie de match
// pour gérer le fait que la metadata Transfer ne propage PAS vers Payout côté
// Stripe Connect.
//
// Sémantique :
//   1. Match row payouts via 2 stratégies en cascade :
//        a) Path nominal : payout.source_transaction (le Transfer source qu'on
//           a créé via stripe.transfers.create) -> match direct sur
//           payouts.stripe_transfer_id.
//        b) Fallback Bundle 3 (T-402) : event.account (Connect account id) ->
//           producers.stripe_account_id -> producer_id -> payouts récents
//           statut IN ('processing','paid') des 30 derniers jours.
//      Si aucun match -> log warn (3 sous-cas) et continue jusqu'à l'audit log
//      pour traçabilité forensique malgré tout.
//   2. UPDATE statut='paid' + stripe_payout_id (defensive si lookup OK).
//   3. Audit log forensique stripe_payout_paid (metadata complète + match_source
//      + matched booléen).
//
// Pas de notification ni d'email (chemin success silencieux côté admin — le
// producer reçoit son virement, c'est suffisant).
//
// Logs préfixés grep-able :
//   - [PAYOUT_PAID_NO_TRANSACTION_NO_MATCH]    : producer trouvé mais aucun
//                                                 payout récent matché.
//   - [PAYOUT_PAID_NO_TRANSACTION_NO_PRODUCER] : event.account présent mais
//                                                 producer introuvable.
//   - [PAYOUT_PAID_NO_TRANSACTION_NO_ACCOUNT]  : ni source_transaction ni
//                                                 event.account.

type StripePayoutWithSource = Stripe.Payout & {
  source_transaction?: string | null;
};

type MatchSource = "source_transaction" | "fallback_account" | "no_match";

export type PayoutPaidResult =
  | "match_via_source_transaction"
  | "match_via_event_account"
  | "no_match_no_source_transaction"
  | "no_match_no_recent_payouts"
  | "no_match_producer_not_found"
  | "no_match_no_account";

export async function syncStripePayoutPaid(
  payout: StripePayoutWithSource,
  eventAccount: string | null,
  admin: SupabaseClient,
): Promise<{
  result: PayoutPaidResult;
  payoutRowId: string | null;
  matchSource: MatchSource;
}> {
  let payoutRowId: string | null = null;
  let matchSource: MatchSource = "no_match";
  let result: PayoutPaidResult = "no_match_no_account";

  // Stratégie (a) — path nominal : match direct via source_transaction
  // sur payouts.stripe_transfer_id.
  if (payout.source_transaction) {
    const { data: updated } = await admin
      .from("payouts")
      .update({ statut: "paid", stripe_payout_id: payout.id })
      .eq("stripe_transfer_id", payout.source_transaction)
      .select("id");
    if (Array.isArray(updated) && updated.length > 0) {
      payoutRowId = String((updated[0] as { id: unknown }).id);
      matchSource = "source_transaction";
      result = "match_via_source_transaction";
    }
  }

  // Stratégie (b) — fallback Bundle 3 (T-402) : event.account ->
  // producers.stripe_account_id -> payouts récents statut IN ('processing',
  // 'paid') des 30 derniers jours. Décision PUSH 1 question D : la metadata
  // Transfer ne propage pas vers Payout côté Stripe Connect.
  if (!payoutRowId) {
    if (!eventAccount) {
      console.warn(
        `[PAYOUT_PAID_NO_TRANSACTION_NO_ACCOUNT] payout=${payout.id} — ni source_transaction ni event.account`,
      );
      result = "no_match_no_account";
    } else {
      const { data: producer } = await admin
        .from("producers")
        .select("id")
        .eq("stripe_account_id", eventAccount)
        .maybeSingle();

      if (!producer) {
        console.warn(
          `[PAYOUT_PAID_NO_TRANSACTION_NO_PRODUCER] payout=${payout.id} account=${eventAccount} — producer introuvable via stripe_account_id`,
        );
        result = "no_match_producer_not_found";
      } else {
        const producerId = (producer as { id: string }).id;
        const since = new Date(
          Date.now() - 30 * 24 * 60 * 60 * 1000,
        ).toISOString();
        const { data: matched } = await admin
          .from("payouts")
          .select("id")
          .eq("producer_id", producerId)
          .in("statut", ["processing", "paid"])
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (matched) {
          const matchedId = String((matched as { id: unknown }).id);
          await admin
            .from("payouts")
            .update({ statut: "paid", stripe_payout_id: payout.id })
            .eq("id", matchedId);
          payoutRowId = matchedId;
          matchSource = "fallback_account";
          result = "match_via_event_account";
        } else {
          console.warn(
            `[PAYOUT_PAID_NO_TRANSACTION_NO_MATCH] payout=${payout.id} account=${eventAccount} producer=${producerId} — aucun payout récent matché`,
          );
          result = "no_match_no_recent_payouts";
        }
      }
    }
  }

  // Audit log forensique (fail-safe interne au helper). destination peut être
  // string (acct/ba_*) ou objet Stripe expansé ; on normalise en string ou null.
  await logPaymentEvent({
    eventType: "stripe_payout_paid",
    metadata: {
      payout_id: payout.id,
      amount: payout.amount,
      currency: payout.currency,
      arrival_date: payout.arrival_date,
      destination:
        typeof payout.destination === "string"
          ? payout.destination
          : (payout.destination?.id ?? null),
      source_transaction: payout.source_transaction ?? null,
      stripe_account: eventAccount,
      match_source: matchSource,
      matched: payoutRowId !== null,
    },
  });

  return { result, payoutRowId, matchSource };
}
