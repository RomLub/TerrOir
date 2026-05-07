import { NextResponse } from "next/server";
import Stripe from "stripe";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe/server";
import { getOrCreateStripeCustomer } from "@/lib/stripe/customer";
import { eurosToCents } from "@/lib/money/cents";
import {
  consumeRateLimit,
  getStripeCreatePaymentIntentRateLimit,
} from "@/lib/rate-limit";

const bodySchema = z.object({
  order_id: z.string().guid(),
  save_card: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.email) {
    return NextResponse.json({ error: "Email manquant" }, { status: 500 });
  }

  // Audit Stripe pré-launch W-2 : rate-limit applicatif user-keyed (10/60s).
  // Cap absorbe 1 PI/checkout + retries 2-3 typiques (réseau, double-clic) +
  // marge confortable. Defensive layer — pas de PCI direct, mais limite
  // l'abus volume détectable côté PSP.
  const rl = await consumeRateLimit(
    getStripeCreatePaymentIntentRateLimit(),
    session.id,
  );
  if (!rl.success) {
    const retryAfter = Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000));
    console.warn(
      `[STRIPE_CREATE_PI_RATE_LIMITED] user=${session.id} cap=${rl.limit} retry_after=${retryAfter}`,
    );
    return NextResponse.json(
      { error: "rate_limited", retry_after: retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();

  // L'accès passe par le client utilisateur (RLS): seul le consumer_id de
  // la commande peut lire sa propre commande.
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select(
      "id, consumer_id, producer_id, montant_total, statut, stripe_payment_intent_id",
    )
    .eq("id", parsed.data.order_id)
    .maybeSingle();

  if (orderError || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.consumer_id !== session.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // T-406 : la route prépare le paiement initial uniquement. Toute commande
  // hors `pending` (confirmed/ready/completed/cancelled/refunded) ne doit pas
  // pouvoir (re)passer ici — bloque aussi le path `update setup_future_usage`
  // ci-dessous sur un PI orphelin d'une commande terminée.
  if (order.statut !== "pending") {
    return NextResponse.json(
      { error: "Order not in pending state" },
      { status: 409 },
    );
  }

  const admin = createSupabaseAdminClient();

  // Audit Stripe M-6 (defense-in-depth) : guard pré-PI sur producer.charges_enabled.
  // L'invariant promoteProducerToPublicIfActive empêche déjà un producer
  // non-charges-enabled d'apparaître en statut='public' côté RLS, mais on
  // attrape ici le cas limite producer charges_enabled au moment de l'order
  // mais qui perd la capability ENTRE order create et PI create (latence
  // webhook account.updated, KYC re-flagged). Évite aussi un transfer cron
  // weekly qui échouera plus tard sans signal côté consumer.
  const { data: producer } = await admin
    .from("producers")
    .select("stripe_charges_enabled")
    .eq("id", order.producer_id)
    .maybeSingle();

  if (!producer?.stripe_charges_enabled) {
    return NextResponse.json(
      { error: "producer_not_ready" },
      { status: 409 },
    );
  }

  // Stripe Customer (Phase 6) : toujours attaché au PI, même si save_card=false.
  // Préparation pour Phase 7 (sélecteur CB enregistrée au checkout) et pour
  // cohérence de l'historique Stripe côté customer.
  const { data: profile } = await admin
    .from("users")
    .select("prenom, nom")
    .eq("id", session.id)
    .maybeSingle();

  let customerId: string;
  try {
    customerId = await getOrCreateStripeCustomer(
      session.id,
      session.email,
      profile?.prenom as string | null | undefined,
      profile?.nom as string | null | undefined,
    );
  } catch (err) {
    return NextResponse.json(
      { error: `Stripe customer error: ${(err as Error).message}` },
      { status: 500 },
    );
  }

  const setupFutureUsage: "off_session" | undefined = parsed.data.save_card
    ? "off_session"
    : undefined;

  // Idempotence : si un PI existe déjà, on ajuste setup_future_usage + customer
  // pour refléter le choix courant (l'user a pu cocher/décocher la checkbox
  // entre 2 clics "Payer") et on renvoie le même client_secret (stable pour
  // la durée de vie du PI).
  if (order.stripe_payment_intent_id) {
    const existing = await stripe.paymentIntents.retrieve(
      order.stripe_payment_intent_id,
    );

    const currentSFU = existing.setup_future_usage ?? null;
    const targetSFU = setupFutureUsage ?? null;
    const customerMismatch = existing.customer !== customerId;

    if (currentSFU !== targetSFU || customerMismatch) {
      // Stripe accepte "" pour unset setup_future_usage. Le cast est requis
      // car le type TS ne liste que les valeurs enum + undefined, pas "".
      await stripe.paymentIntents.update(order.stripe_payment_intent_id, {
        customer: customerId,
        setup_future_usage: (setupFutureUsage ?? "") as "off_session",
      });
    }

    return NextResponse.json({ client_secret: existing.client_secret });
  }

  // Separate charges & transfers: le paiement arrive en totalité sur le
  // compte plateforme TerrOir. Le virement net vers le producteur
  // (montant_total − 6%) est déclenché plus tard par /api/cron/weekly-payout.
  const amount = eurosToCents(order.montant_total);

  // Audit Stripe phase 2 M-1 + L-3 (2026-05-05) — passage à dynamic payment
  // methods. Active Card + Apple Pay + Google Pay (domain `www.terroir-local.fr`
  // enregistré via scripts/register-payment-method-domain.ts) selon la décision
  // du compte Stripe Dashboard. `allow_redirects: 'never'` filtre les méthodes
  // redirect-based (SEPA Debit redirect, Bancontact, iDEAL...) pour préserver
  // le flow single-page existant : confirmPayment retourne le PI inline sans
  // sortir de la page checkout. SEPA Direct Debit reste explicitement OUT
  // de cette phase (chantier V1.1 dédié — implique un handler
  // payment_intent.processing + UI processing-state + adaptation cron
  // order-timeout, non triviale). Link reste désactivable côté Dashboard
  // (compte → settings/payment_methods) si Romain veut le retirer ; le code
  // ne le hardcode plus.
  // T-404 idempotencyKey : `pi_create_${order.id}` (UUID stable). Empeche
  // la double creation Stripe sur retry (timeout reseau, double-clic client,
  // re-render React). Cohérent avec le pattern `refund_${order_id}_*` des
  // 3 paths refund (T-408) + retry-failed-refund.ts.
  let pi: Stripe.PaymentIntent;
  try {
    pi = await stripe.paymentIntents.create(
      {
        amount,
        currency: "eur",
        customer: customerId,
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: "never",
        },
        ...(setupFutureUsage && { setup_future_usage: setupFutureUsage }),
        metadata: {
          order_id: order.id,
          producer_id: order.producer_id,
          consumer_id: order.consumer_id ?? "",
        },
      },
      { idempotencyKey: `pi_create_${order.id}` },
    );
  } catch (err) {
    // T-405 path borderline : 2 requetes paralleles partagent la meme
    // idempotencyKey mais des params differents (ex. save_card toggled
    // entre 2 clics) → Stripe rejette la 2e avec idempotency_key_in_use.
    // Le PI gagnant a deja ete persiste DB par la 1re requete (UPDATE
    // ci-dessous) → on requery + retrieve pour renvoyer son client_secret.
    if (err instanceof Stripe.errors.StripeIdempotencyError) {
      console.warn(
        `[CREATE_PI_IDEMPOTENCY_REUSE] order=${order.id} reason=${err.message}`,
      );
      const { data: refreshed } = await admin
        .from("orders")
        .select("stripe_payment_intent_id")
        .eq("id", order.id)
        .maybeSingle();
      if (!refreshed?.stripe_payment_intent_id) {
        return NextResponse.json(
          { error: "Idempotency conflict unrecoverable" },
          { status: 500 },
        );
      }
      const winning = await stripe.paymentIntents.retrieve(
        refreshed.stripe_payment_intent_id,
      );
      return NextResponse.json({ client_secret: winning.client_secret });
    }
    throw err;
  }

  // T-405 verrou DB anti-race : `.is('stripe_payment_intent_id', null)` +
  // `.select('id')` detecte le cas ou une requete parallele a deja persiste
  // un PI entre notre SELECT initial et cet UPDATE. 0 lignes touchees =
  // race confirmee → on cancel notre PI orphelin (compensation symetrique)
  // puis retrieve le PI gagnant via requery DB.
  const { data: updatedRows, error: updateError } = await supabase
    .from("orders")
    .update({ stripe_payment_intent_id: pi.id })
    .eq("id", order.id)
    .is("stripe_payment_intent_id", null)
    .select("id");

  if (updateError) {
    return NextResponse.json(
      { error: `Payment intent created but not persisted: ${updateError.message}` },
      { status: 500 },
    );
  }

  if (!updatedRows || updatedRows.length === 0) {
    // Race detectee : cancel best-effort le PI orphelin pour ne pas laisser
    // un PI non-confirmable trainer cote Stripe (cohabitation 2 PI sur 1 order).
    try {
      await stripe.paymentIntents.cancel(pi.id);
    } catch (cancelErr) {
      // Best-effort : log greppable mais on continue vers retrieve PI gagnant.
      console.warn(
        `[CREATE_PI_RACE_ROLLBACK] order=${order.id} pi=${pi.id} reason=${(cancelErr as Error).message}`,
      );
    }
    const { data: refreshed } = await admin
      .from("orders")
      .select("stripe_payment_intent_id")
      .eq("id", order.id)
      .maybeSingle();
    if (!refreshed?.stripe_payment_intent_id) {
      return NextResponse.json(
        { error: "Race condition unrecoverable" },
        { status: 500 },
      );
    }
    const winning = await stripe.paymentIntents.retrieve(
      refreshed.stripe_payment_intent_id,
    );
    return NextResponse.json({ client_secret: winning.client_secret });
  }

  return NextResponse.json({ client_secret: pi.client_secret });
}
