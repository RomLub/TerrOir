import { waitUntil } from "@vercel/functions";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendTemplate } from "@/lib/resend/send";
import { sendNewOrderProducerSms } from "@/lib/twilio/sms";
import { NEXT_PUBLIC_PRODUCER_URL } from "@/lib/env/urls";
import OrderConfirmedProducer, {
  subject as producerSubject,
} from "@/lib/resend/templates/order-confirmed-producer";
import OrderRevivalBlocked, {
  subject as revivalBlockedSubject,
} from "@/lib/resend/templates/order-revival-blocked";
import type { OrderItemLine } from "@/lib/resend/templates/order-confirmed-consumer";
import type { PaymentSucceededResult } from "@/lib/stripe/handle-payment-succeeded";
import { formatOrderNumber } from "@/lib/orders/order-number";

// debt-P1-2 — extraction de la branche `payment_intent.succeeded` du webhook
// route.tsx (501 lignes -> ~280 lignes une fois extraite). Le handler
// `syncStripePaymentSucceeded` gère déjà la transition DB / RPC résurrection
// / refund. Cette fonction-ci orchestre les notifications post-RPC en
// fonction de `result` :
//   - no_metadata / order_not_found / already_confirmed   : no-op
//   - anomaly                                             : INSERT notification webhook_anomaly
//   - revival_blocked_stock / revival_blocked_slot        : email consumer (waitUntil)
//   - revival_refund_failed                               : INSERT notification anomaly_refund_failed
//   - pending_to_notify / revived_to_notify               : email + SMS producer (waitUntil)
//
// Tous les .catch des waitUntil incluent un sendOpsAlert
// (`[STRIPE_WEBHOOK_BG_ERR]`) — comportement préservé identique au inline pré-
// extraction. Pas de changement de comportement runtime.

export async function notifyPaymentSucceeded(
  pi: Stripe.PaymentIntent,
  admin: SupabaseClient,
  result: PaymentSucceededResult,
  orderId: string | null,
): Promise<void> {
  // No-op paths : pas de notif ni d'anomaly à écrire.
  if (
    result === "no_metadata" ||
    result === "order_not_found" ||
    result === "already_confirmed"
  ) {
    return;
  }

  // Anomaly : Stripe a encaissé mais l'order est terminée côté plateforme
  // pour une raison incompatible (refunded, cancel volontaire). Trace pour
  // investigation admin.
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
    return;
  }

  // Résurrection bloquée stock/slot : refund Stripe OK + UPDATE closure_reason
  // déjà fait dans syncStripePaymentSucceeded. Audit log déjà poussé.
  // Reste à notifier le consumer par email pour fermer proprement le flow
  // (le client a vu son paiement s'effectuer, doit comprendre qu'il a été
  // remboursé).
  if (
    result === "revival_blocked_stock" ||
    result === "revival_blocked_slot"
  ) {
    if (!orderId) return;

    // Fetch détails order pour composer l'email (montant + nom exploitation
    // + email consumer + code commande).
    const { data: order } = await admin
      .from("orders")
      .select(
        "id, code_commande, consumer_id, producer_id, montant_total",
      )
      .eq("id", orderId)
      .maybeSingle();

    if (!order) return;

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
      // Découplage notification via waitUntil (cohérent avec le pattern
      // producer notif). Stripe ack 200 immédiat ; envoi email asynchrone,
      // helper sendTemplate ne throw pas.
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
    return;
  }

  // Résurrection bloquée + refund Stripe a échoué : alerte admin pour retry
  // manuel. État DB préservé (cancelled+payment_failed) pour permettre un
  // nouveau passage de la RPC après remédiation.
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
    return;
  }

  // result === "pending_to_notify" || "revived_to_notify" :
  // dans les deux cas, orderId est non-null et l'order est maintenant en
  // statut='pending'. Le producer doit être notifié (premier moment où il
  // y a une commande à honorer pour lui ; sur le path résurrection, rien
  // n'avait été envoyé lors du payment_failed initial).
  if (!orderId) return; // défensif (typage : revived/pending → orderId non-null)

  const { data: order } = await admin
    .from("orders")
    .select(
      "id, producer_id, consumer_id, statut, code_commande, producer_order_seq, date_retrait, heure_retrait, montant_total",
    )
    .eq("id", orderId)
    .maybeSingle();

  if (!order) return;

  // Lookups parallèles pour composer l'email producteur. ADR-0015 : on
  // récupère aussi producer_number pour composer le numero_commande
  // affichable côté producteur (le code_commande reste pour le payload
  // consumer côté SMS rappel J0).
  const [{ data: consumer }, { data: producer }, { data: lines }] =
    await Promise.all([
      admin
        .from("users")
        .select("prenom, nom, email, telephone")
        .eq("id", order.consumer_id)
        .maybeSingle(),
      admin
        .from("producers")
        .select("user_id, nom_exploitation, producer_number")
        .eq("id", order.producer_id)
        .maybeSingle(),
      admin
        .from("order_items")
        .select("quantite, sous_total, products(nom, unite)")
        .eq("order_id", order.id),
    ]);

  if (!producer?.user_id) return;

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
  // Dashboard polluée à 13%). On répond 200 dès que les opérations DB sont
  // faites, et les envois email/SMS s'exécutent en background dans le même
  // lifecycle serverless. Les helpers ne throw pas (try/catch interne +
  // log [EMAIL_SEND_FAIL] / notifications.statut='failed'), donc le .catch
  // ici est purement défensif.
  const tasks: Promise<unknown>[] = [];

  if (producerUser?.email) {
    const props = {
      numeroCommande: formatOrderNumber(
        producer.producer_number ?? 0,
        (order.producer_order_seq as number) ?? 0,
      ),
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
}
