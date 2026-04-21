import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe/server";

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
    const account = await stripe.accounts.create({
      type: "express",
      country: "FR",
      email: session.email ?? undefined,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_type: "individual",
    });
    stripeAccountId = account.id;

    const { error: updateError } = await admin
      .from("producers")
      .update({ stripe_account_id: stripeAccountId })
      .eq("id", producer.id);
    if (updateError) {
      return NextResponse.json(
        { error: `Account created but not persisted: ${updateError.message}` },
        { status: 500 },
      );
    }
  }

  const producerBase =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://pro.localhost:3000";

  const accountLink = await stripe.accountLinks.create({
    account: stripeAccountId,
    refresh_url: `${producerBase}/connect/refresh`,
    return_url: `${producerBase}/connect/done`,
    type: "account_onboarding",
  });

  return NextResponse.json({
    url: accountLink.url,
    account_id: stripeAccountId,
  });
}
