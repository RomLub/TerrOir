import { NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/cron/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { googleMapsUrl, sendTemplate } from "@/lib/resend/send";
import OrderReminderConsumer, {
  subject as reminderSubject,
} from "@/lib/resend/templates/order-reminder-consumer";

function tomorrowIso(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export async function POST(request: Request) {
  const authError = assertCronAuth(request);
  if (authError) return authError;

  const admin = createSupabaseAdminClient();
  const targetDate = tomorrowIso();

  const { data: orders, error } = await admin
    .from("orders")
    .select(
      "id, code_commande, consumer_id, producer_id, date_retrait, heure_retrait",
    )
    .eq("statut", "confirmed")
    .eq("date_retrait", targetDate);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!orders || orders.length === 0) {
    return NextResponse.json({ target: targetDate, sent: 0 });
  }

  let sent = 0;
  const failures: Array<{ order_id: string; error: string }> = [];

  for (const order of orders) {
    const { data: consumer } = await admin
      .from("users")
      .select("email")
      .eq("id", order.consumer_id)
      .maybeSingle();
    const { data: producer } = await admin
      .from("producers")
      .select("nom_exploitation, adresse, commune, code_postal")
      .eq("id", order.producer_id)
      .maybeSingle();

    if (!consumer?.email || !producer) continue;

    const adresse = [producer.adresse, producer.code_postal, producer.commune]
      .filter(Boolean)
      .join(", ");

    const props = {
      codeCommande: order.code_commande,
      exploitation: producer.nom_exploitation,
      dateRetrait: order.date_retrait ?? targetDate,
      heureRetrait: (order.heure_retrait ?? "").slice(0, 5),
      adresse,
      mapsUrl: googleMapsUrl(adresse || producer.nom_exploitation),
    };

    const result = await sendTemplate({
      to: consumer.email,
      userId: order.consumer_id,
      template: "order_reminder_consumer",
      subject: reminderSubject(props),
      element: <OrderReminderConsumer {...props} />,
      metadata: { order_id: order.id, code_commande: order.code_commande },
    });

    if (result.ok) sent += 1;
    else failures.push({ order_id: order.id, error: result.error });
  }

  return NextResponse.json({ target: targetDate, sent, failures });
}
