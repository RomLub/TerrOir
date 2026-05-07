import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe/server";
import {
  extractWebhookClientIp,
  isStripeWebhookIp,
} from "@/lib/stripe/ip-allowlist";
import { syncStripeAccountFlags } from "@/lib/stripe/sync-account-flags";
import { syncStripePaymentFailed } from "@/lib/stripe/handle-payment-failed";
import { syncStripePaymentSucceeded } from "@/lib/stripe/handle-payment-succeeded";
import { notifyPaymentSucceeded } from "@/lib/stripe/handle-payment-succeeded-notify";
import { syncStripePayoutFailed } from "@/lib/stripe/handle-payout-failed";
import { syncStripePayoutPaid } from "@/lib/stripe/handle-payout-paid";
import { syncStripeDisputeCreated } from "@/lib/stripe/handle-dispute-created";
import { syncStripeDisputeUpdated } from "@/lib/stripe/handle-dispute-updated";
import { syncStripeDisputeClosed } from "@/lib/stripe/handle-dispute-closed";
import { syncStripeEarlyFraudWarning } from "@/lib/stripe/handle-early-fraud-warning";
import { syncStripeChargeRefunded } from "@/lib/stripe/handle-charge-refunded";
import { syncStripeAccountDeauthorized } from "@/lib/stripe/handle-account-deauthorized";
import { checkOrMarkProcessed } from "@/lib/webhook-events/check-or-mark-processed";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Route Handler: on lit le body brut avec request.text() pour que
// stripe.webhooks.constructEvent puisse vérifier la signature.
export async function POST(request: Request) {
  // Audit Stripe phase B L-1 : IP allowlist en défense en profondeur AVANT
  // la vérif signature. Bypass implicite en non-production via
  // isStripeWebhookIp (cf lib/stripe/ip-allowlist.ts) — les scans/floods
  // hors prod ne touchent pas cette route, et `stripe listen` en dev
  // continue de marcher sans config.
  const clientIp = extractWebhookClientIp(request.headers);
  if (!isStripeWebhookIp(clientIp)) {
    const userAgent = request.headers.get("user-agent") ?? "unknown";
    console.warn(
      `[STRIPE_WEBHOOK_IP_REJECTED] ip=${clientIp ?? "null"} ua=${userAgent}`,
    );
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const signature = request.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !secret) {
    return NextResponse.json(
      { error: "Missing Stripe signature or webhook secret" },
      { status: 400 },
    );
  }

  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    return NextResponse.json(
      { error: `Invalid signature: ${(err as Error).message}` },
      { status: 400 },
    );
  }

  const admin = createSupabaseAdminClient();

  // Dédup applicative (T-103) : si Stripe rejoue cet event (auto-retry sur
  // 5xx, replay manuel Dashboard, network glitch), on ack 200 sans rejouer
  // les effets de bord (UPDATE DB, emails Resend, SMS Twilio, audit logs).
  // Mécanisme par INSERT exclusif sur PK event_id de webhook_events_processed
  // (cf. lib/webhook-events/check-or-mark-processed.ts + migration
  // 20260429000000). Filtré sur les 4 events ayant des effets de bord
  // observables — pollue pas la table avec les events handled `default`.
  const DEDUP_TARGETS = new Set([
    "payment_intent.succeeded",
    "payment_intent.payment_failed",
    "account.updated",
    "payout.paid",
    // T-081 PR-B : charge.dispute.created ajouté au Set parce qu'on log
    // un audit forensique + console.error sur ce case. Sans dédup, un
    // rejouage Stripe poserait un 2e event audit identique.
    "charge.dispute.created",
    // Bundle 3 webhook events go-Live (T-401 + T-403 extended) : tous
    // les nouveaux handlers ont des effets de bord (UPDATE DB, audit
    // log, INSERT notifications, sendTemplate Resend) — dédup obligatoire
    // pour idempotence sur rejouage Stripe.
    // NOTE : `transfer.failed` PAS dans le Set parce que Stripe Connect
    // Express ne l'émet pas. Les transfers via stripe.transfers.create()
    // sont synchrones côté API ; l'échec côté création est géré dans
    // lib/stripe/payouts.ts (catch synchrone, hors scope webhook).
    "payout.failed",
    "charge.dispute.updated",
    "charge.dispute.closed",
    // Audit Stripe phase 2 M-3 (2026-05-05) — 3 nouveaux events utiles, tous
    // avec effets de bord persistés (refund Stripe + UPDATE order pour EFW,
    // audit log seul pour charge.refunded settlement, UPDATE producer flags
    // + email URGENT admin pour account.application.deauthorized).
    "radar.early_fraud_warning.created",
    "charge.refunded",
    "account.application.deauthorized",
  ]);

  if (DEDUP_TARGETS.has(event.type)) {
    try {
      const { alreadyProcessed } = await checkOrMarkProcessed(
        admin,
        event.id,
        event.type,
      );
      if (alreadyProcessed) {
        return NextResponse.json({ received: true, deduped: true });
      }
    } catch (err) {
      // Erreur DB hors 23505 → throw du helper. On renvoie 500 pour que
      // Stripe retry (le retry refera l'INSERT et saura distinguer si
      // c'était un glitch transitoire ou non).
      return NextResponse.json(
        { error: (err as Error).message },
        { status: 500 },
      );
    }
  }

  try {
    switch (event.type) {
      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent;

        // Logique de transition extraite dans `lib/stripe/handle-payment-succeeded.ts` :
        // distingue cas nominal (pending), résurrection 3DS-retry
        // (cancelled+payment_failed → pending), idempotence (déjà
        // confirmed/completed) et anomaly (refunded ou cancelled avec
        // autre closure_reason). Cf doc fonction.
        const { result, orderId } = await syncStripePaymentSucceeded(pi, admin);

        // debt-P1-2 — orchestration des notifications post-RPC extraite dans
        // `lib/stripe/handle-payment-succeeded-notify.tsx` (anomaly notif,
        // email consumer revival_blocked, email + SMS producer pending/revived,
        // notif refund_failed). Cf doc fonction. La séparation matche le
        // pattern des autres handlers webhook (handle-payment-failed,
        // handle-payout-paid, handle-dispute-*). Aucun changement de
        // comportement runtime.
        await notifyPaymentSucceeded(pi, admin, result, orderId);
        break;
      }

      case "payment_intent.payment_failed": {
        // Logique extraite dans `lib/stripe/handle-payment-failed.ts` :
        // pose closure_reason='payment_failed', guard contre la
        // rétrogradation confirmed→cancelled (rejouage Stripe tardif),
        // assertTransition + revalidatePublicStats. Cf doc fonction.
        await syncStripePaymentFailed(
          event.data.object as Stripe.PaymentIntent,
          admin,
        );
        break;
      }

      case "account.updated": {
        // Émis à chaque changement d'état d'un compte Stripe Connect
        // (onboarding progressant, KYC validé, capabilities activées…).
        // Logique extraite dans `lib/stripe/sync-account-flags.ts` pour
        // testabilité ; ack 200 dans tous les cas (cf doc fonction).
        const account = event.data.object as Stripe.Account;
        await syncStripeAccountFlags(account, admin);

        // Phase 3 multi-events audit (T-081 PR-B) — log APRÈS succès
        // syncStripeAccountFlags : si syncStripeAccountFlags throw, on
        // tombe dans le catch global → 500 → Stripe retry → on
        // relogguera. user_id null (orphelin Stripe-direct, traçable
        // par stripe_account_id metadata).
        await logPaymentEvent({
          eventType: "stripe_account_updated",
          metadata: {
            stripe_account_id: account.id,
            charges_enabled: account.charges_enabled,
            payouts_enabled: account.payouts_enabled,
            details_submitted: account.details_submitted,
          },
        });
        break;
      }

      case "payout.paid": {
        // Bundle 3 (T-402) : extraction T-400 du traitement inline initial
        // vers `lib/stripe/handle-payout-paid.ts`. Le handler gère le match
        // 2 stratégies (source_transaction direct, fallback event.account ->
        // producers -> payouts récents) + UPDATE statut='paid' +
        // stripe_payout_id + audit log forensique stripe_payout_paid.
        const payoutPaid = event.data.object as Stripe.Payout & {
          source_transaction?: string | null;
        };
        await syncStripePayoutPaid(payoutPaid, event.account ?? null, admin);
        break;
      }

      case "charge.dispute.created": {
        // Bundle 3 webhook events go-Live (T-403) : extraction du traitement
        // inline initial (T-081 PR-B) vers `lib/stripe/handle-dispute-created.tsx`.
        // Le handler gère lookup order + INSERT public.disputes + audit log
        // metadata étendu (requires_action, evidence_due_by, dispute_status)
        // + INSERT notifications placeholder admin + waitUntil(sendTemplate(...))
        // alerte email urgente vers SUPPORT_EMAIL.
        await syncStripeDisputeCreated(
          event.data.object as Stripe.Dispute,
          admin,
        );
        break;
      }

      case "charge.dispute.updated": {
        // Bundle 3 (T-403 extended) : transitions non-terminales du dispute
        // (under_review, warning_*). Info-only, pas d'email ni notification
        // (l'admin a déjà l'alerte urgente sur dispute.created et l'info
        // finale sur dispute.closed). UPDATE statut côté disputes + audit log.
        await syncStripeDisputeUpdated(
          event.data.object as Stripe.Dispute,
          admin,
        );
        break;
      }

      case "charge.dispute.closed": {
        // Bundle 3 (T-403 extended) : résolution terminale du dispute
        // (won, lost, warning_closed). Info-only avec email résolution
        // vers SUPPORT_EMAIL. UPDATE statut + closed_at côté disputes,
        // audit log, notifications placeholder.
        await syncStripeDisputeClosed(
          event.data.object as Stripe.Dispute,
          admin,
        );
        break;
      }

      case "payout.failed": {
        // Bundle 3 (T-401) : Payout Connect account -> banque producteur
        // échoué (RIB invalide, banque fermée, plafonds). Stripe ne re-tente
        // pas automatiquement -> action admin requise. Lookup row payouts
        // via payout.metadata.payout_id (T-414 futur) ou fallback event.account
        // -> producers.stripe_account_id -> producer_id (correction PUSH 1
        // question D vs brief TD initial).
        await syncStripePayoutFailed(
          event.data.object as Stripe.Payout,
          event.account ?? null,
          admin,
        );
        break;
      }

      case "radar.early_fraud_warning.created": {
        // Audit Stripe phase 2 M-3 — Visa/MC signalent une fraude AVANT
        // dispute. Refund pré-emptif évite chargeback fee + perte commerce.
        // Cf lib/stripe/handle-early-fraud-warning.tsx pour la doc.
        await syncStripeEarlyFraudWarning(
          event.data.object as Stripe.Radar.EarlyFraudWarning,
          admin,
        );
        break;
      }

      case "charge.refunded": {
        // Audit Stripe phase 2 M-3 — settlement réel du refund (vs émission
        // refund.created). Audit log forensique pour reconstitution chronologie
        // comptable. Pas de UPDATE table refunds (n'existe pas en V1, audit_logs
        // suffit). Cf lib/stripe/handle-charge-refunded.ts pour la doc.
        await syncStripeChargeRefunded(
          event.data.object as Stripe.Charge,
          admin,
        );
        break;
      }

      case "account.application.deauthorized": {
        // Audit Stripe phase 2 M-3 — producer disconnecte son Connect account
        // depuis Dashboard Stripe. Sans handler, producer.stripe_account_id
        // reste figé en DB et le prochain transfer va échouer en
        // account_invalid. Reset flags + statut='suspended' + email URGENT
        // admin. Cf lib/stripe/handle-account-deauthorized.tsx pour la doc.
        // IMPORTANT : event.data.object = Stripe.Application (pas Account).
        // Le Connect account déauthorisé vient via event.account.
        const application = event.data.object as { id: string; object: string };
        await syncStripeAccountDeauthorized(
          application,
          event.account ?? null,
          admin,
        );
        break;
      }

      default:
        break;
    }
  } catch (err) {
    // Stripe réessaiera si on renvoie 5xx — c'est voulu.
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true });
}
