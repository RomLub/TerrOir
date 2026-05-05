import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe/server";
import { NEXT_PUBLIC_PRODUCER_URL } from "@/lib/env/urls";
import {
  consumeRateLimit,
  getStripeConnectOnboardRateLimit,
} from "@/lib/rate-limit";

// Génère un lien d'onboarding Stripe Connect pour le producteur connecté.
// Crée le compte Express si aucun n'existe encore et persiste le stripe_account_id.
export async function POST() {
  const session = await getSessionUser();
  if (!session || (!session.roles.includes("producer") && !session.isAdmin)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Audit Stripe pré-launch W-2 : rate-limit applicatif user-keyed (3/60s).
  // 1 onboard/producer en pratique, 3 retries généreux (erreur réseau,
  // refresh page Stripe Connect). Logué [STRIPE_CONNECT_ONBOARD_RATE_LIMITED].
  const rl = await consumeRateLimit(
    getStripeConnectOnboardRateLimit(),
    session.id,
  );
  if (!rl.success) {
    const retryAfter = Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000));
    console.warn(
      `[STRIPE_CONNECT_ONBOARD_RATE_LIMITED] user=${session.id} cap=${rl.limit} retry_after=${retryAfter}`,
    );
    return NextResponse.json(
      { error: "rate_limited", retry_after: retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const admin = createSupabaseAdminClient();

  const { data: producer } = await admin
    .from("producers")
    .select("id, stripe_account_id")
    .eq("user_id", session.id)
    .maybeSingle();

  if (!producer) {
    return NextResponse.json(
      { error: "Producer profile not found" },
      { status: 404 },
    );
  }

  let stripeAccountId = producer.stripe_account_id as string | null;

  if (!stripeAccountId) {
    // Audit Stripe L-2 (2026-05-05) : `business_type` retiré (auparavant
    // hardcodé à 'individual' qui force le KYC auto-entrepreneur). Stripe
    // demande désormais le type via le accountLink natif (sélecteur
    // Auto-entrepreneur / SARL / EURL / SAS / GAEC / Autre tenu à jour côté
    // Stripe). Plus simple côté UI TerrOir et flow KYC à jour.
    //
    // Audit Stripe H-2 (2026-05-05) : controller properties remplacent le
    // legacy `type: "express"`. Comportement Express préservé via les 4
    // properties explicites (cf docs/audits/audit-stripe-h2-connect-v2-
    // 2026-05-05.md §1) :
    //   - controller.losses.payments = "application" : la plateforme TerrOir
    //     paye les chargebacks (cohérent finding H-2 Phase 1 — modèle Express).
    //   - controller.fees.payer = "application" : équivalent fonctionnel à
    //     l'ancien "application_express" implicite. La différence n'a aucun
    //     impact sur Separate Charges & Transfers (cf doc Stripe direct-
    //     charges-fee-payer-behavior : "Any activity occurring at the
    //     platform account level is billed to your platform").
    //   - controller.requirement_collection = "stripe" : Stripe Express
    //     Dashboard collecte le KYC (pas TerrOir).
    //   - controller.stripe_dashboard.type = "express" : producer accède
    //     à un Dashboard Stripe Express simplifié (lecture seule, payouts).
    //
    // Comptes Connect existants (créés avec legacy type:"express") restent
    // 100% fonctionnels — Stripe rétro-attribue les controller properties
    // équivalentes côté serveur (cf doc Stripe migrate-to-controller-
    // properties : "you don't need to update your existing connected
    // accounts"). Aucune migration data, aucun changement webhook
    // (account.updated reste identique).
    const account = await stripe.accounts.create({
      country: "FR",
      email: session.email ?? undefined,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      controller: {
        fees: { payer: "application" },
        losses: { payments: "application" },
        requirement_collection: "stripe",
        stripe_dashboard: { type: "express" },
      },
    });
    stripeAccountId = account.id;

    const { error: updateError } = await admin
      .from("producers")
      .update({ stripe_account_id: stripeAccountId })
      .eq("id", producer.id);
    if (updateError) {
      // T-418 compensation : l'account Stripe vient d'être créé (l.33-42),
      // 0 activité par construction sauf race rarissime (producer ouvre
      // Dashboard externe pendant le crash de l'UPDATE). On tente
      // accounts.del best-effort pour éviter l'accumulation d'orphelins.
      // Si del throw → log greppable + continuer (pas de re-throw).
      // Pattern symétrique cleanup.ts mais inline (sémantique différente :
      // compensation transactionnelle ≠ suppression RGPD).
      try {
        await stripe.accounts.del(stripeAccountId);
      } catch (delErr) {
        console.warn(
          `[CONNECT_ONBOARD_ROLLBACK_FAILED] account=${stripeAccountId} producer=${producer.id} reason=${(delErr as Error).message ?? "unknown"}`,
        );
      }
      return NextResponse.json(
        { error: `Account created but not persisted: ${updateError.message}` },
        { status: 500 },
      );
    }
  }

  const accountLink = await stripe.accountLinks.create({
    account: stripeAccountId,
    refresh_url: `${NEXT_PUBLIC_PRODUCER_URL}/connect/refresh`,
    return_url: `${NEXT_PUBLIC_PRODUCER_URL}/connect/done`,
    type: "account_onboarding",
  });

  return NextResponse.json({
    url: accountLink.url,
    account_id: stripeAccountId,
  });
}
