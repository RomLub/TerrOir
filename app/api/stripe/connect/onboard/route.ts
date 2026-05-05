import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe/server";
import { NEXT_PUBLIC_PRODUCER_URL } from "@/lib/env/urls";

// Génère un lien d'onboarding Stripe Connect pour le producteur connecté.
// Crée le compte Express si aucun n'existe encore et persiste le stripe_account_id.
export async function POST() {
  const session = await getSessionUser();
  if (!session || (!session.roles.includes("producer") && !session.isAdmin)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
    const account = await stripe.accounts.create({
      type: "express",
      country: "FR",
      email: session.email ?? undefined,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
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
