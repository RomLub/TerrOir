import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe/server";
import { syncStripeAccountFlags } from "@/lib/stripe/sync-account-flags";
import { syncStripePaymentFailed } from "@/lib/stripe/handle-payment-failed";
import { syncStripePaymentSucceeded } from "@/lib/stripe/handle-payment-succeeded";
import { checkOrMarkProcessed } from "@/lib/webhook-events/check-or-mark-processed";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { NEXT_PUBLIC_PRODUCER_URL } from "@/lib/env/urls";
import { sendTemplate } from "@/lib/resend/send";
import { sendNewOrderProducerSms } from "@/lib/twilio/sms";
import OrderConfirmedProducer, {
  subject as producerSubject,
} from "@/lib/resend/templates/order-confirmed-producer";
import OrderRevivalBlocked, {
  subject as revivalBlockedSubject,
} from "@/lib/resend/templates/order-revival-blocked";
import type { OrderItemLine } from "@/lib/resend/templates/order-confirmed-consumer";

// Route Handler: on lit le body brut avec request.text() pour que
// stripe.webhooks.constructEvent puisse vérifier la signature.
export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !secret) {
    return NextResponse.json(
      { error: "Missing Stripe signature or webhook secret" },
      { status: 400 },
    );
  }

  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    return NextResponse.json(
      { error: `Invalid signature: ${(err as Error).message}` },
      { status: 400 },
    );
  }

  const admin = createSupabaseAdminClient();

  // Dédup applicative (T-103) : si Stripe rejoue cet event (auto-retry sur
  // 5xx, replay manuel Dashboard, network glitch), on ack 200 sans rejouer
  // les effets de bord (UPDATE DB, emails Resend, SMS Twilio, audit logs).
  // Mécanisme par INSERT exclusif sur PK event_id de webhook_events_processed
  // (cf. lib/webhook-events/check-or-mark-processed.ts + migration
  // 20260429000000). Filtré sur les 4 events ayant des effets de bord
  // observables — pollue pas la table avec les events handled `default`.
  const DEDUP_TARGETS = new Set([
    "payment_intent.succeeded",
    "payment_intent.payment_failed",
    "account.updated",
    "payout.paid",
  ]);

  if (DEDUP_TARGETS.has(event.type)) {
    try {
      const { alreadyProcessed } = await checkOrMarkProcessed(
        admin,
        event.id,
        event.type,
      );
      if (alreadyProcessed) {
        return NextResponse.json({ received: true, deduped: true });
      }
    } catch (err) {
      // Erreur DB hors 23505 → throw du helper. On renvoie 500 pour que
      // Stripe retry (le retry refera l'INSERT et saura distinguer si
      // c'était un glitch transitoire ou non).
      return NextResponse.json(
        { error: (err as Error).message },
        { status: 500 },
      );
    }
  }

  try {
    switch (event.type) {
      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent;

        // Logique de transition extraite dans `lib/stripe/handle-payment-succeeded.ts` :
        // distingue cas nominal (pending), résurrection 3DS-retry
        // (cancelled+payment_failed → pending), idempotence (déjà
        // confirmed/ready/completed) et anomaly (refunded ou cancelled
        // avec autre cancellation_reason). Cf doc fonction.
        const { result, orderId } = await syncStripePaymentSucceeded(pi, admin);

        // No-op paths : pas de notif ni d'anomaly à écrire.
        if (
          result === "no_metadata" ||
          result === "order_not_found" ||
          result === "already_confirmed"
        ) {
          break;
        }

        // Anomaly : Stripe a encaissé mais l'order est terminée côté
        // plateforme pour une raison incompatible (refunded, cancel
        // volontaire). Trace pour investigation admin.
        if (result === "anomaly") {
          await admin.from("notifications").insert({
            user_id: null,
            type: "email",
            template: "webhook_anomaly",
            statut: "failed",
            metadata: {
              order_id: orderId,
              event: "payment_intent.succeeded",
              payment_intent_id: pi.id,
            },
          });
          break;
        }

        // Résurrection bloquée stock/slot : refund Stripe OK + UPDATE
        // cancellation_reason déjà fait dans syncStripePaymentSucceeded.
        // Audit log déjà poussé. Reste à notifier le consumer par email
        // pour fermer proprement le flow (le client a vu son paiement
        // s'effectuer, doit comprendre qu'il a été remboursé).
        if (
          result === "revival_blocked_stock" ||
          result === "revival_blocked_slot"
        ) {
          if (!orderId) break;

          // Fetch détails order pour composer l'email (montant + nom
          // exploitation + email consumer + code commande).
          const { data: order } = await admin
            .from("orders")
            .select(
              "id, code_commande, consumer_id, producer_id, montant_total",
            )
            .eq("id", orderId)
            .maybeSingle();

          if (!order) break;

          const [{ data: consumerUser }, { data: producer }] = await Promise.all([
            admin
              .from("users")
              .select("email")
              .eq("id", order.consumer_id)
              .maybeSingle(),
            admin
              .from("producers")
              .select("nom_exploitation")
              .eq("id", order.producer_id)
              .maybeSingle(),
          ]);

          if (consumerUser?.email && producer) {
            const blockedReason: "stock" | "slot" =
              result === "revival_blocked_stock" ? "stock" : "slot";
            const props = {
              codeCommande: order.code_commande ?? "",
              exploitation: producer.nom_exploitation as string,
              amount: Number(order.montant_total),
              blockedReason,
            };
            // Découplage notification via waitUntil (cohérent avec le
            // pattern producer notif). Stripe ack 200 immédiat ; envoi
            // email asynchrone, helper sendTemplate ne throw pas.
            waitUntil(
              sendTemplate({
                to: consumerUser.email,
                userId: order.consumer_id as string | null,
                template: "order_revival_blocked",
                subject: revivalBlockedSubject(props),
                element: <OrderRevivalBlocked {...props} />,
                metadata: {
                  order_id: order.id,
                  code_commande: order.code_commande,
                  payment_intent_id: pi.id,
                  blocked_reason: result,
                },
              }).catch((err) => {
                console.error(
                  `[STRIPE_WEBHOOK_BG_ERR] order=${order.id} payment_intent=${pi.id} error=${(err as Error).message}`,
                );
              }),
            );
          }
          break;
        }

        // Résurrection bloquée + refund Stripe a échoué : alerte admin
        // pour retry manuel. État DB préservé (cancelled+payment_failed)
        // pour permettre un nouveau passage de la RPC après remédiation.
        if (result === "revival_refund_failed") {
          await admin.from("notifications").insert({
            user_id: null,
            type: "email",
            template: "webhook_anomaly_refund_failed",
            statut: "failed",
            metadata: {
              order_id: orderId,
              event: "payment_intent.succeeded",
              payment_intent_id: pi.id,
            },
          });
          break;
        }

        // result === "pending_to_notify" || "revived_to_notify" :
        // dans les deux cas, orderId est non-null et l'order est
        // maintenant en statut='pending'. Le producer doit être notifié
        // (premier moment où il y a une commande à honorer pour lui ;
        // sur le path résurrection, rien n'avait été envoyé lors du
        // payment_failed initial).
        if (!orderId) break; // défensif (typage : revived/pending → orderId non-null)

        const { data: order } = await admin
          .from("orders")
          .select(
            "id, producer_id, consumer_id, statut, code_commande, date_retrait, heure_retrait, montant_total",
          )
          .eq("id", orderId)
          .maybeSingle();

        if (!order) break;

        // Lookups parallèles pour composer l'email producteur
        const [{ data: consumer }, { data: producer }, { data: lines }] =
          await Promise.all([
            admin
              .from("users")
              .select("prenom, nom, email, telephone")
              .eq("id", order.consumer_id)
              .maybeSingle(),
            admin
              .from("producers")
              .select("user_id, nom_exploitation")
              .eq("id", order.producer_id)
              .maybeSingle(),
            admin
              .from("order_items")
              .select("quantite, sous_total, products(nom, unite)")
              .eq("order_id", order.id),
          ]);

        if (!producer?.user_id) break;

        const { data: producerUser } = await admin
          .from("users")
          .select("email, telephone")
          .eq("id", producer.user_id)
          .maybeSingle();

        const items: OrderItemLine[] = (lines ?? []).map(
          (l: {
            quantite: number;
            sous_total: number;
            products:
              | { nom: string; unite: string }
              | { nom: string; unite: string }[]
              | null;
          }) => {
            const product = Array.isArray(l.products)
              ? l.products[0]
              : l.products;
            return {
              nom: product?.nom ?? "",
              quantite: Number(l.quantite),
              unite: product?.unite ?? "",
              sousTotal: Number(l.sous_total),
            };
          },
        );

        // Notifications externes (Resend + Twilio) découplées via waitUntil :
        // Stripe coupait à 10s sur cold start (HTTP timeout → retry → metric
        // Dashboard polluée à 13%). On répond 200 dès que les opérations DB
        // sont faites, et les envois email/SMS s'exécutent en background dans
        // le même lifecycle serverless. Les helpers ne throw pas (try/catch
        // interne + log [EMAIL_SEND_FAIL] / notifications.statut='failed'),
        // donc le .catch ici est purement défensif.
        const tasks: Promise<unknown>[] = [];

        if (producerUser?.email) {
          const props = {
            codeCommande: order.code_commande,
            customerPrenom: consumer?.prenom ?? "",
            customerNom: consumer?.nom ?? "",
            customerEmail: consumer?.email ?? "",
            customerTelephone: consumer?.telephone ?? null,
            dateRetrait: order.date_retrait ?? "",
            heureRetrait: (order.heure_retrait ?? "").slice(0, 5),
            items,
            total: Number(order.montant_total),
            confirmUrl: `${NEXT_PUBLIC_PRODUCER_URL}/commandes/${order.id}?action=confirm`,
            cancelUrl: `${NEXT_PUBLIC_PRODUCER_URL}/commandes/${order.id}?action=cancel`,
          };
          tasks.push(
            sendTemplate({
              to: producerUser.email,
              userId: producer.user_id,
              template: "order_confirmed_producer",
              subject: producerSubject(props),
              element: <OrderConfirmedProducer {...props} />,
              metadata: {
                order_id: order.id,
                code_commande: order.code_commande,
                payment_intent_id: pi.id,
              },
            }),
          );
        }

        if (producerUser?.telephone) {
          tasks.push(
            sendNewOrderProducerSms({
              to: producerUser.telephone,
              userId: producer.user_id,
              customerPrenom: consumer?.prenom ?? "un client",
              dateRetrait: order.date_retrait ?? "",
            }),
          );
        }

        if (tasks.length > 0) {
          waitUntil(
            Promise.all(tasks).catch((err) => {
              console.error(
                `[STRIPE_WEBHOOK_BG_ERR] order=${order.id} payment_intent=${pi.id} error=${(err as Error).message}`,
              );
            }),
          );
        }
        break;
      }

      case "payment_intent.payment_failed": {
        // Logique extraite dans `lib/stripe/handle-payment-failed.ts` :
        // pose cancellation_reason='payment_failed', guard contre la
        // rétrogradation confirmed/ready→cancelled (rejouage Stripe tardif),
        // assertTransition + revalidatePublicStats. Cf doc fonction.
        await syncStripePaymentFailed(
          event.data.object as Stripe.PaymentIntent,
          admin,
        );
        break;
      }

      case "account.updated": {
        // Émis à chaque changement d'état d'un compte Stripe Connect
        // (onboarding progressant, KYC validé, capabilities activées…).
        // Logique extraite dans `lib/stripe/sync-account-flags.ts` pour
        // testabilité ; ack 200 dans tous les cas (cf doc fonction).
        await syncStripeAccountFlags(event.data.object as Stripe.Account, admin);
        break;
      }

      case "payout.paid": {
        // Émis quand un virement Stripe Connect → banque du producteur
        // est effectivement payé. event.account = Connect account id.
        // `source_transaction` n'est pas typé sur Stripe.Payout dans le SDK
        // v17; on y accède via une extension optionnelle et on ne fait
        // rien si Stripe ne le renseigne pas.
        const payout = event.data.object as Stripe.Payout & {
          source_transaction?: string | null;
        };
        if (payout.source_transaction) {
          await admin
            .from("payouts")
            .update({ statut: "paid", stripe_payout_id: payout.id })
            .eq("stripe_transfer_id", payout.source_transaction);
        }
        break;
      }

      default:
        break;
    }
  } catch (err) {
    // Stripe réessaiera si on renvoie 5xx — c'est voulu.
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true });
}
