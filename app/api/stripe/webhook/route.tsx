import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendTemplate } from "@/lib/resend/send";
import { sendNewOrderProducerSms } from "@/lib/twilio/sms";
import OrderConfirmedProducer, {
  subject as producerSubject,
} from "@/lib/resend/templates/order-confirmed-producer";
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

  try {
    switch (event.type) {
      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent;
        const orderId = pi.metadata?.order_id;
        if (!orderId) break;

        // La commande est créée avec statut='pending' par défaut.
        // Ici on vérifie la cohérence et on notifie — on NE réécrit PAS
        // le statut (évite d'écraser une transition déjà effectuée, ex.
        // cancelled en cas de race avec /orders/[id]/cancel).
        const { data: order } = await admin
          .from("orders")
          .select(
            "id, producer_id, consumer_id, statut, code_commande, date_retrait, heure_retrait, montant_total",
          )
          .eq("id", orderId)
          .maybeSingle();

        if (!order || order.statut !== "pending") {
          await admin.from("notifications").insert({
            user_id: null,
            type: "email",
            template: "webhook_anomaly",
            statut: "failed",
            metadata: {
              order_id: orderId,
              statut_actuel: order?.statut ?? null,
              event: "payment_intent.succeeded",
              payment_intent_id: pi.id,
            },
          });
          break;
        }

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

        const producerBase =
          process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://pro.localhost:3000";

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

        // 1. Email producteur
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
            confirmUrl: `${producerBase}/commandes/${order.id}?action=confirm`,
            cancelUrl: `${producerBase}/commandes/${order.id}?action=cancel`,
          };
          await sendTemplate({
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
          });
        }

        // 2. SMS backup producteur (systématique si téléphone dispo)
        if (producerUser?.telephone) {
          await sendNewOrderProducerSms({
            to: producerUser.telephone,
            userId: producer.user_id,
            customerPrenom: consumer?.prenom ?? "un client",
            dateRetrait: order.date_retrait ?? "",
          });
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const pi = event.data.object as Stripe.PaymentIntent;
        const orderId = pi.metadata?.order_id;
        if (!orderId) break;

        await admin
          .from("orders")
          .update({
            statut: "cancelled",
            cancelled_at: new Date().toISOString(),
          })
          .eq("id", orderId);
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
