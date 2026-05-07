import { NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/cron/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dbErrorResponse } from "@/lib/api/db-error-response";
import { googleMapsUrl, sendTemplate } from "@/lib/resend/send";
import OrderReminderConsumer, {
  subject as reminderSubject,
} from "@/lib/resend/templates/order-reminder-consumer";
import { mapWithConcurrency } from "@/lib/concurrency/p-limit";

// Audit RPC M-1 : envoi des rappels Resend en parallèle borné (cap 5).

export const maxDuration = 60;

const RESEND_CONCURRENCY = 5;

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

  // Audit perf-postgres-2026-05-05 C-3 : SELECT initial enrichi via embeds
  // PostgREST. Élimine le N+1 historique (1 + 2N queries → 1 query unique).
  // Le cron utilise service_role → bypass RLS, embeds autorisés.
  const { data: orders, error } = await admin
    .from("orders")
    .select(
      `id, code_commande, consumer_id, producer_id, date_retrait, heure_retrait,
       producer:producer_id ( nom_exploitation, adresse, commune, code_postal ),
       consumer:consumer_id ( email )`,
    )
    .eq("statut", "confirmed")
    .eq("date_retrait", targetDate);

  if (error) {
    return dbErrorResponse(error, "CRON_REMINDER_CONSUMER_SELECT_ERR");
  }
  if (!orders || orders.length === 0) {
    return NextResponse.json({ target: targetDate, sent: 0 });
  }

  type SendOutcome =
    | { ok: true; order_id: string }
    | { ok: false; order_id: string; error: string }
    | { skipped: true };

  const settled = await mapWithConcurrency(
    orders,
    RESEND_CONCURRENCY,
    async (order): Promise<SendOutcome> => {
      // Embeds PostgREST FK to-one : objet le plus souvent, array dans
      // certaines versions de @supabase/supabase-js — normalisation safe.
      const producerEmbed = Array.isArray(order.producer)
        ? order.producer[0]
        : order.producer;
      const consumerEmbed = Array.isArray(order.consumer)
        ? order.consumer[0]
        : order.consumer;
      const producer = producerEmbed as
        | { nom_exploitation: string; adresse: string | null; commune: string | null; code_postal: string | null }
        | null;
      const consumer = consumerEmbed as { email: string | null } | null;

      if (!consumer?.email || !producer) return { skipped: true };

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

      if (result.ok) return { ok: true, order_id: order.id };
      return { ok: false, order_id: order.id, error: result.error };
    },
  );

  let sent = 0;
  const failures: Array<{ order_id: string; error: string }> = [];
  for (let i = 0; i < settled.length; i += 1) {
    const r = settled[i]!;
    if (r.status === "fulfilled") {
      const v = r.value;
      if ("skipped" in v) continue;
      if (v.ok) sent += 1;
      else failures.push({ order_id: v.order_id, error: v.error });
    } else {
      const order = orders[i]!;
      failures.push({
        order_id: order.id,
        error: (r.reason as Error)?.message ?? "worker_crash",
      });
    }
  }

  return NextResponse.json({ target: targetDate, sent, failures });
}

export const GET = POST;
