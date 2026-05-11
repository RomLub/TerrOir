import { NextResponse } from "next/server";
import { TZDate } from "@date-fns/tz";
import { assertCronAuth } from "@/lib/cron/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendTemplate } from "@/lib/resend/send";
import ReviewRequest, {
  subject as reviewSubject,
} from "@/lib/resend/templates/review-request";
import { NEXT_PUBLIC_APP_URL } from "@/lib/env/urls";
import { logReviewFollowupEvent } from "@/lib/audit-logs/log-review-followup-event";
import { mapWithConcurrency } from "@/lib/concurrency/p-limit";

// bugs-P2-5 (2026-05-12) : la fenetre J-2 / J-7 est calculee en Europe/Paris
// pour aligner sur la perception consommateur (validation pickup faite a
// 18h Paris doit declencher la relance J+2 a peu pres 18h Paris 2 jours
// plus tard, pas a minuit UTC).
//
// A re-valider post-Live volume-dependant : si le cron tourne 1x/jour a 9h
// Paris, la fenetre 00:00-23:59:59.999 Paris du jour J-N (mode actuel) est
// correcte. Si le cron passe a multiples runs/jour, il faudra reduire la
// fenetre pour ne pas re-traiter (le marqueur dedup
// review_followup_d{2,7}_sent_at protege deja en pratique).
const FOLLOWUP_TZ = "Europe/Paris";

// Envoie les relances review J+2 et J+7 pour les commandes completed
// qui n'ont pas encore de review.
//
// Doctrine dédup (cluster review_followup) : marqueur DB
// orders.review_followup_d{2,7}_sent_at posé AVANT sendTemplate via UPDATE
// conditionnel race-safe (UPDATE ... WHERE col IS NULL — un re-run cron
// trouve 0 rows affected et skip via audit `review_followup_dedup_blocked`).
// Trade-off accepté : si crash entre coche et send, l'email est manqué
// silencieusement (mieux 1 mail manqué qu'un double-envoi qui dégrade trust).
//
// Audit log cluster review_followup_* (4 events) :
//   - review_followup_sent_d{2,7} : email parti OK
//   - review_followup_skipped : raison interne en metadata.reason
//     (review_exists | consumer_email_missing | producer_missing | send_failed)
//   - review_followup_dedup_blocked : marqueur DB déjà coché (re-run cron)
//
// F-020 (audit pré-launch 2026-05) : refacto N+1 → embeds PostgREST sur la
// query principale (1 query unique au lieu de 1 + 3N) + mapWithConcurrency
// cap 5 sur le batch send. Pattern aligné sur order-timeout/reminder-consumer.
// Le check `reviews.order_id` reste fait dans le worker (1 query / order)
// mais en parallèle borné — acceptable au volume cible (<50 pickups/j).

export const maxDuration = 60;

const RESEND_CONCURRENCY = 5;

type FollowupSummary = {
  dayOffset: 2 | 7;
  sent: number;
  skipped: number;
  dedupBlocked: number;
};

async function sendBatch(dayOffset: 2 | 7): Promise<FollowupSummary> {
  const admin = createSupabaseAdminClient();
  // bugs-P2-5 : fenetre J-N en Europe/Paris (00:00:00.000 -> 23:59:59.999
  // Paris). TZDate manipule les composantes Date/Hours en zone locale Paris,
  // converti en UTC via getTime() pour les comparaisons SQL timestamptz.
  const nowParis = TZDate.tz(FOLLOWUP_TZ);
  const targetParis = new TZDate(nowParis.getTime(), FOLLOWUP_TZ);
  targetParis.setDate(targetParis.getDate() - dayOffset);
  const dayStartParis = new TZDate(targetParis.getTime(), FOLLOWUP_TZ);
  dayStartParis.setHours(0, 0, 0, 0);
  const dayEndParis = new TZDate(targetParis.getTime(), FOLLOWUP_TZ);
  dayEndParis.setHours(23, 59, 59, 999);
  const dayStart = new Date(dayStartParis.getTime());
  const dayEnd = new Date(dayEndParis.getTime());

  const dedupColumn =
    dayOffset === 2
      ? "review_followup_d2_sent_at"
      : "review_followup_d7_sent_at";

  // F-020 : SELECT initial enrichi via embeds PostgREST
  // (`consumer:consumer_id (...)`, `producer:producer_id (...)`). Élimine
  // 2 N+1 (consumer + producer fetch). Le cron utilise service_role →
  // bypass RLS, embeds autorisés.
  //
  // On lit aussi le marqueur dédup pour discriminer en amont les orders
  // déjà cochées (skip + audit dedup_blocked) sans tenter un UPDATE inutile.
  // Le filtre IS NULL en query principale fait l'essentiel mais on garde
  // une seconde defense via UPDATE conditionnel.
  const { data: orders } = await admin
    .from("orders")
    .select(
      `id, code_commande, consumer_id, producer_id, ${dedupColumn},
       consumer:consumer_id ( email ),
       producer:producer_id ( nom_exploitation )`,
    )
    .eq("statut", "completed")
    .gte("completed_at", dayStart.toISOString())
    .lte("completed_at", dayEnd.toISOString())
    .is(dedupColumn, null);

  if (!orders || orders.length === 0) {
    return { dayOffset, sent: 0, skipped: 0, dedupBlocked: 0 };
  }

  type WorkerOutcome = "sent" | "skipped" | "dedup_blocked";

  const settled = await mapWithConcurrency(
    orders,
    RESEND_CONCURRENCY,
    async (order): Promise<WorkerOutcome> => {
      // Embeds PostgREST FK to-one : objet le plus souvent, array dans
      // certaines versions de @supabase/supabase-js — normalisation safe.
      const consumerEmbed = Array.isArray(order.consumer)
        ? order.consumer[0]
        : order.consumer;
      const producerEmbed = Array.isArray(order.producer)
        ? order.producer[0]
        : order.producer;
      const consumer = consumerEmbed as { email: string | null } | null;
      const producer = producerEmbed as { nom_exploitation: string } | null;

      // Skip si déjà une review (le consumer a noté avant la fenêtre relance).
      const { data: existing } = await admin
        .from("reviews")
        .select("id")
        .eq("order_id", order.id)
        .maybeSingle();
      if (existing) {
        void logReviewFollowupEvent({
          eventType: "review_followup_skipped",
          userId: order.consumer_id,
          metadata: {
            order_id: order.id,
            day_offset: dayOffset,
            reason: "review_exists",
          },
        });
        return "skipped";
      }

      if (!consumer?.email) {
        void logReviewFollowupEvent({
          eventType: "review_followup_skipped",
          userId: order.consumer_id,
          metadata: {
            order_id: order.id,
            day_offset: dayOffset,
            reason: "consumer_email_missing",
          },
        });
        return "skipped";
      }
      if (!producer) {
        void logReviewFollowupEvent({
          eventType: "review_followup_skipped",
          userId: order.consumer_id,
          metadata: {
            order_id: order.id,
            day_offset: dayOffset,
            reason: "producer_missing",
          },
        });
        return "skipped";
      }

      // ─── Pose marqueur dédup AVANT sendTemplate ──────────────────────────
      // Pattern race-safe : UPDATE ... WHERE col IS NULL retourne 0 rows si
      // une autre exécution concurrente du cron a déjà coché. On bascule
      // dans dedupBlocked + audit log dédié — pas de send.
      //
      // .select("id") force le retour des rows affectées pour discriminer
      // 0 vs 1 (Supabase JS retourne data: [] sur UPDATE no-op).
      const { data: claimed } = await admin
        .from("orders")
        .update({ [dedupColumn]: new Date().toISOString() })
        .eq("id", order.id)
        .is(dedupColumn, null)
        .select("id");

      if (!claimed || claimed.length === 0) {
        void logReviewFollowupEvent({
          eventType: "review_followup_dedup_blocked",
          userId: order.consumer_id,
          metadata: {
            order_id: order.id,
            day_offset: dayOffset,
          },
        });
        return "dedup_blocked";
      }

      const props = {
        codeCommande: order.code_commande,
        exploitation: producer.nom_exploitation,
        reviewUrl: `${NEXT_PUBLIC_APP_URL}/compte/mes-avis/${order.id}/nouveau`,
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

      if (result.ok) {
        void logReviewFollowupEvent({
          eventType:
            dayOffset === 2
              ? "review_followup_sent_d2"
              : "review_followup_sent_d7",
          userId: order.consumer_id,
          metadata: {
            order_id: order.id,
            day_offset: dayOffset,
            code_commande: order.code_commande,
          },
        });
        return "sent";
      }
      // Send a échoué après pose du marqueur : trade-off documenté
      // dans le commentaire d'en-tête (mieux 1 mail manqué qu'un double).
      // On audit `skipped` avec reason=send_failed pour observabilité —
      // le marqueur reste posé donc pas de retry auto.
      void logReviewFollowupEvent({
        eventType: "review_followup_skipped",
        userId: order.consumer_id,
        metadata: {
          order_id: order.id,
          day_offset: dayOffset,
          reason: "send_failed",
        },
      });
      return "skipped";
    },
  );

  let sent = 0;
  let skipped = 0;
  let dedupBlocked = 0;
  for (let i = 0; i < settled.length; i += 1) {
    const r = settled[i]!;
    if (r.status === "fulfilled") {
      if (r.value === "sent") sent += 1;
      else if (r.value === "skipped") skipped += 1;
      else dedupBlocked += 1;
    } else {
      // mapWithConcurrency capture les rejects en interne ; le worker
      // ci-dessus ne throw pas en pratique. Filet : on log et compte
      // en skipped pour ne pas perdre de visibilité.
      const order = orders[i]!;
      console.error(
        `[REVIEW_FOLLOWUP_WORKER_CRASH] order=${order.id} reason=${(r.reason as Error)?.message ?? "unknown"}`,
      );
      skipped += 1;
    }
  }

  return { dayOffset, sent, skipped, dedupBlocked };
}

export async function POST(request: Request) {
  const authError = assertCronAuth(request);
  if (authError) return authError;

  const [d2, d7] = await Promise.all([sendBatch(2), sendBatch(7)]);
  return NextResponse.json({
    j2: { sent: d2.sent, skipped: d2.skipped, dedup_blocked: d2.dedupBlocked },
    j7: { sent: d7.sent, skipped: d7.skipped, dedup_blocked: d7.dedupBlocked },
  });
}

export const GET = POST;
