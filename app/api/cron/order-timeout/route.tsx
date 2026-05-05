import { NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/cron/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe/server";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";
import { classifyRefundError } from "@/lib/refund-incidents/classify-error";
import { recordRefundAttempt } from "@/lib/refund-incidents/record-refund-attempt";
import { revalidatePublicStats } from "@/lib/stats/revalidate";
import {
  assertTransition,
  InvalidOrderTransitionError,
  type OrderStatus,
} from "@/lib/orders/stateMachine";
import { sendTemplate } from "@/lib/resend/send";
import OrderTimeoutCancelled, {
  subject as timeoutSubject,
} from "@/lib/resend/templates/order-timeout-cancelled";
import { mapWithConcurrency } from "@/lib/concurrency/p-limit";

// Quotidien à 9h UTC (cf. vercel.json schedule "0 9 * * *") : annule +
// rembourse les commandes pending depuis +24h. Audit Stripe L-4 (2026-05-05)
// alignement commentaire ↔ schedule. Conséquence UX : timeout effectif
// compris entre 24h et 48h (vs 24-25h en hourly), trade-off accepté pour
// limiter les invocations cron à 1/jour.
//
// Audit RPC M-1 : passage de boucle séquentielle à mapWithConcurrency
// (cap 5 — opérations mixtes Stripe + Resend, on prend le plus restrictif).

export const maxDuration = 60;

const STRIPE_RESEND_CONCURRENCY = 5;

type OrderResult = {
  order_id: string;
  refunded: boolean;
  error?: string;
  db_error?: string;
  transition_error?: string;
};

export async function POST(request: Request) {
  const authError = assertCronAuth(request);
  if (authError) return authError;

  const admin = createSupabaseAdminClient();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Audit perf-postgres-2026-05-05 C-3 : SELECT initial enrichi via embeds
  // PostgREST (`producer:producer_id (...)`, `consumer:consumer_id (...)`).
  // Élimine le N+1 historique (1 + 2N queries → 1 query unique). Le cron
  // utilise service_role → bypass RLS, embeds autorisés.
  const { data: orders, error } = await admin
    .from("orders")
    .select(
      `id, code_commande, consumer_id, producer_id, montant_total, stripe_payment_intent_id,
       producer:producer_id ( nom_exploitation ),
       consumer:consumer_id ( email )`,
    )
    .eq("statut", "pending")
    .lt("created_at", cutoff);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!orders || orders.length === 0) {
    return NextResponse.json({ processed: 0 });
  }

  const settled = await mapWithConcurrency(
    orders,
    STRIPE_RESEND_CONCURRENCY,
    async (order): Promise<OrderResult> => {
      // T-100 : assertTransition AVANT toute I/O Stripe pour eviter d'emettre
      // un refund Stripe irrecuperable sur une transition refusee. Cible
      // tentative basee sur la presence d'un PI (refunded si paye, sinon
      // cancelled) — pattern aligne cancel/route.tsx:88-99.
      const tentativeFinalStatus: OrderStatus = order.stripe_payment_intent_id
        ? "refunded"
        : "cancelled";
      try {
        assertTransition("pending", tentativeFinalStatus);
      } catch (e) {
        if (e instanceof InvalidOrderTransitionError) {
          // Graceful skip : pas d'I/O Stripe ni UPDATE DB, l'erreur remonte
          // dans transition_error pour traitement par run suivant ou alerte.
          return {
            order_id: order.id,
            refunded: false,
            transition_error: e.message,
          };
        }
        throw e;
      }

      let refundEmitted = false;
      let refundError: string | undefined;

      if (order.stripe_payment_intent_id) {
        // T-409 : pre-check status PI avant refund. Une order peut rester
        // pending +24h pour 2 raisons distinctes :
        //   1. PI succeeded reçu, producer n'a juste pas confirmé → order PAYÉE
        //   2. PI créé mais succeeded jamais reçu (3DS abandonné) → NON PAYÉE
        // Tenter refund sur (2) génère une erreur Stripe + faux positif retry.
        const pi = await stripe.paymentIntents.retrieve(
          order.stripe_payment_intent_id,
        );

        if (pi.status !== "succeeded") {
          // Skip refund + audit forensique distinct (pas consommé par le
          // cron retry T-412).
          await logPaymentEvent({
            eventType: "order_timeout_no_payment",
            userId: order.consumer_id,
            metadata: {
              order_id: order.id,
              payment_intent_id: order.stripe_payment_intent_id,
              pi_status: pi.status,
            },
          });
        } else {
          try {
            // T-408 idempotencyKey : `refund_${order.id}_timeout` (context
            // discriminator distinct des paths manual_cancel / admin / retry).
            await stripe.refunds.create(
              { payment_intent: order.stripe_payment_intent_id },
              { idempotencyKey: `refund_${order.id}_timeout` },
            );
            refundEmitted = true;
          } catch (e) {
            refundError = (e as Error).message;
            // T-102.2.b — double écriture refund_incidents + audit_logs (helper
            // fail-safe : ne throw pas, retourne null en cas d'échec write).
            const classified = classifyRefundError(e);
            await recordRefundAttempt({
              orderId: order.id,
              kind: "timeout",
              paymentIntentId: order.stripe_payment_intent_id,
              consumerId: order.consumer_id,
              blockedReason: null,
              outcome: "failed",
              classified,
            });
            // T-107 audit_log forensique conservé en parallèle (décision T-102.1
              // « hybride » : audit_logs reste source forensique RGPD/PCI).
            await logPaymentEvent({
              eventType: "order_timeout_refund_failed",
              userId: order.consumer_id,
              metadata: {
                order_id: order.id,
                payment_intent_id: order.stripe_payment_intent_id,
                refund_error: refundError,
              },
            });
          }
        }
      }

      const finalStatus: OrderStatus = refundEmitted ? "refunded" : "cancelled";

      // T-100 : re-check defensive si la cible reelle a bascule (refund KO ou
      // pre-check pi.status≠succeeded). Filet pour future durcissement de la
      // matrice TRANSITIONS — a matrice constante (pending→cancelled et
      // pending→refunded sont legal post-T-151) ce code est mort.
      if (finalStatus !== tentativeFinalStatus) {
        try {
          assertTransition("pending", finalStatus);
        } catch (e) {
          if (e instanceof InvalidOrderTransitionError) {
            // Drift critique : refund Stripe deja emis, transition refusee →
            // pas d'UPDATE DB. Warn distinct de [REFUND_DB_DRIFT].
            console.warn(
              `[REFUND_TRANSITION_DRIFT] order=${order.id} ` +
                `refunded=${refundEmitted} ` +
                `final_status=${finalStatus} ` +
                `error=${e.message}`,
            );
            return {
              order_id: order.id,
              refunded: refundEmitted,
              transition_error: e.message,
            };
          }
          throw e;
        }
      }

      const { error: updateError } = await admin
        .from("orders")
        .update({
          statut: finalStatus,
          closure_reason: "timeout",
          cancelled_at: new Date().toISOString(),
        })
        .eq("id", order.id);

      if (updateError) {
        // Drift Stripe/DB : refund déjà émis chez Stripe mais statut DB
        // toujours pending → prochain run du cron retentera + risque de
        // double refund. Préfixe grep-able pour réconciliation manuelle.
        if (refundEmitted) {
          console.warn(
            `[REFUND_DB_DRIFT] order=${order.id} pi=${order.stripe_payment_intent_id} ${updateError.message}`,
          );
        }
        return {
          order_id: order.id,
          refunded: false,
          db_error: updateError.message,
        };
      }

      // Embeds PostgREST FK to-one : objet le plus souvent, array dans
      // certaines versions de @supabase/supabase-js — normalisation safe.
      const producerEmbed = Array.isArray(order.producer)
        ? order.producer[0]
        : order.producer;
      const consumerEmbed = Array.isArray(order.consumer)
        ? order.consumer[0]
        : order.consumer;
      const producer = producerEmbed as { nom_exploitation: string } | null;
      const consumer = consumerEmbed as { email: string | null } | null;

      if (consumer?.email && producer) {
        const props = {
          codeCommande: order.code_commande,
          exploitation: producer.nom_exploitation,
          amount: Number(order.montant_total),
        };
        await sendTemplate({
          to: consumer.email,
          userId: order.consumer_id,
          template: "order_timeout_cancelled",
          subject: timeoutSubject(props),
          element: <OrderTimeoutCancelled {...props} />,
          metadata: { order_id: order.id, code_commande: order.code_commande },
        });
      }

      return {
        order_id: order.id,
        refunded: refundEmitted,
        error: refundError,
      };
    },
  );

  const results: OrderResult[] = [];
  for (let i = 0; i < settled.length; i += 1) {
    const r = settled[i]!;
    if (r.status === "fulfilled") {
      results.push(r.value);
    } else {
      // mapWithConcurrency capture les rejects en interne ; le worker
      // ci-dessus throw uniquement sur des erreurs vraiment inattendues
      // (assertTransition non-InvalidOrderTransitionError). On log et on
      // remonte un db_error générique pour ne pas perdre de visibilité.
      const order = orders[i]!;
      console.error(
        `[ORDER_TIMEOUT_WORKER_CRASH] order=${order.id} reason=${(r.reason as Error)?.message ?? "unknown"}`,
      );
      results.push({
        order_id: order.id,
        refunded: false,
        db_error: (r.reason as Error)?.message ?? "worker_crash",
      });
    }
  }

  // Une seule invalidation atomique en sortie de boucle si au moins un
  // UPDATE a réussi : évite N invalidations sur un batch large + no-op
  // silent si toutes les UPDATE échouent (cache stale est préférable à
  // une invalidation à vide). T-100 : `transition_error` (pre-refund OU
  // re-check post-refund) signale aussi un order sans UPDATE DB → exclu.
  if (results.some((r) => !r.db_error && !r.transition_error)) {
    await revalidatePublicStats({ source: "cron-order-timeout" });
  }

  return NextResponse.json({ processed: results.length, results });
}

export const GET = POST;
