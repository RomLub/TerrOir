import { NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/cron/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendReminderSms } from "@/lib/twilio/sms";
import { googleMapsUrl } from "@/lib/resend/send";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(request: Request) {
  const authError = assertCronAuth(request);
  if (authError) return authError;

  const admin = createSupabaseAdminClient();
  const today = todayIso();

  const { data: orders, error } = await admin
    .from("orders")
    .select(
      "id, code_commande, consumer_id, producer_id, date_retrait, heure_retrait",
    )
    .eq("statut", "confirmed")
    .eq("date_retrait", today);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!orders || orders.length === 0) {
    return NextResponse.json({ target: today, sent: 0 });
  }

  let sent = 0;
  const skipped: string[] = [];
  const failures: Array<{ order_id: string; error: string }> = [];

  for (const order of orders) {
    const { data: consumer } = await admin
      .from("users")
      .select("telephone, sms_optin")
      .eq("id", order.consumer_id)
      .maybeSingle();

    if (!consumer?.sms_optin || !consumer.telephone) {
      skipped.push(order.id);
      continue;
    }

    const { data: producer } = await admin
      .from("producers")
      .select("nom_exploitation, adresse, commune, code_postal")
      .eq("id", order.producer_id)
      .maybeSingle();
    if (!producer) continue;

    const adresse = [producer.adresse, producer.code_postal, producer.commune]
      .filter(Boolean)
      .join(", ");

    const result = await sendReminderSms({
      to: consumer.telephone,
      userId: order.consumer_id,
      codeCommande: order.code_commande,
      heureRetrait: (order.heure_retrait ?? "").slice(0, 5),
      exploitation: producer.nom_exploitation,
      mapsUrl: googleMapsUrl(adresse || producer.nom_exploitation),
    });

    if (result.ok) sent += 1;
    else failures.push({ order_id: order.id, error: result.error });
  }

  return NextResponse.json({ target: today, sent, skipped, failures });
}
