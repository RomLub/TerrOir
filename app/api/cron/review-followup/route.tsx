import { NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/cron/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendTemplate } from "@/lib/resend/send";
import ReviewRequest, {
  subject as reviewSubject,
} from "@/lib/resend/templates/review-request";

// Envoie les relances review J+2 et J+7 pour les commandes completed
// qui n'ont pas encore de review.
async function sendBatch(dayOffset: 2 | 7) {
  const admin = createSupabaseAdminClient();
  const now = new Date();
  const target = new Date(now);
  target.setUTCDate(now.getUTCDate() - dayOffset);
  const dayStart = new Date(target);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(target);
  dayEnd.setUTCHours(23, 59, 59, 999);

  const { data: orders } = await admin
    .from("orders")
    .select("id, code_commande, consumer_id, producer_id")
    .eq("statut", "completed")
    .gte("completed_at", dayStart.toISOString())
    .lte("completed_at", dayEnd.toISOString());

  if (!orders) return { sent: 0, dayOffset };

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  let sent = 0;

  for (const order of orders) {
    // Skip si déjà une review
    const { data: existing } = await admin
      .from("reviews")
      .select("id")
      .eq("order_id", order.id)
      .maybeSingle();
    if (existing) continue;

    const { data: consumer } = await admin
      .from("users")
      .select("email")
      .eq("id", order.consumer_id)
      .maybeSingle();
    const { data: producer } = await admin
      .from("producers")
      .select("nom_exploitation")
      .eq("id", order.producer_id)
      .maybeSingle();
    if (!consumer?.email || !producer) continue;

    const props = {
      codeCommande: order.code_commande,
      exploitation: producer.nom_exploitation,
      reviewUrl: `${appUrl}/compte/commandes/${order.id}/avis`,
      dayOffset,
    } as const;

    const result = await sendTemplate({
      to: consumer.email,
      userId: order.consumer_id,
      template: `review_request_j${dayOffset}`,
      subject: reviewSubject(props),
      element: <ReviewRequest {...props} />,
      metadata: { order_id: order.id, code_commande: order.code_commande },
    });
    if (result.ok) sent += 1;
  }

  return { sent, dayOffset };
}

export async function POST(request: Request) {
  const authError = assertCronAuth(request);
  if (authError) return authError;

  const [d2, d7] = await Promise.all([sendBatch(2), sendBatch(7)]);
  return NextResponse.json({ j2: d2.sent, j7: d7.sent });
}
