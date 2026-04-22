import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe/server";

// Phase 6 Stripe Customer — fix Constat 1 :
// Après un checkout avec save_card=true, Stripe attache la CB au Customer
// mais ne set PAS invoice_settings.default_payment_method. Résultat : sur
// /compte/paiements, la CB n'apparaît pas "Par défaut" même si c'est la
// seule du Customer.
//
// Ce endpoint est appelé après un confirmPayment réussi quand save_card=true :
//   - si le Customer a déjà un default_payment_method → no-op
//   - sinon → pick la CB la plus récente attachée et la marque comme default
//
// Fail-open côté client : si ça échoue, pas de blocage (le paiement a déjà
// réussi, l'user pourra set un default manuellement depuis /compte/paiements).

const bodySchema = z.object({ order_id: z.string().uuid() });

export async function POST(request: Request) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // Ownership : l'order doit appartenir au caller (guard cohérent avec
  // le pattern de create-payment-intent).
  const supabase = createSupabaseServerClient();
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, consumer_id")
    .eq("id", parsed.data.order_id)
    .maybeSingle();

  if (orderError || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.consumer_id !== session.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Stripe Customer de l'user
  const admin = createSupabaseAdminClient();
  const { data: user } = await admin
    .from("users")
    .select("stripe_customer_id")
    .eq("id", session.id)
    .maybeSingle();

  const customerId = user?.stripe_customer_id as string | null | undefined;
  if (!customerId) {
    // Defensive : si on arrive ici, c'est que le PI a été créé sans
    // customer attaché (ne devrait pas arriver post-Phase 6).
    return NextResponse.json({ success: false, reason: "no_customer" });
  }

  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted) {
    return NextResponse.json({ success: false, reason: "customer_deleted" });
  }

  const currentDefault = customer.invoice_settings?.default_payment_method;
  if (currentDefault) {
    return NextResponse.json({ success: true, changed: false });
  }

  // Pas de default → pick la CB la plus récente et la marque comme default.
  const paymentMethods = await stripe.paymentMethods.list({
    customer: customerId,
    type: "card",
    limit: 10,
  });

  if (paymentMethods.data.length === 0) {
    // Edge case : confirmPayment a retourné succeeded mais l'attach côté
    // Stripe n'a pas encore propagé. L'user pourra set un default
    // manuellement depuis /compte/paiements.
    return NextResponse.json({ success: false, reason: "no_payment_methods" });
  }

  // list() retourne les PMs par created DESC par défaut → [0] = plus récente.
  const pm = paymentMethods.data[0];
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: pm.id },
  });

  return NextResponse.json({ success: true, changed: true, payment_method_id: pm.id });
}
