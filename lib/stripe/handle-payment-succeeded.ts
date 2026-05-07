import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { revalidatePublicStats } from "@/lib/stats/revalidate";
import { stripe } from "@/lib/stripe/server";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";
import { classifyRefundError } from "@/lib/refund-incidents/classify-error";
import { recordRefundAttempt } from "@/lib/refund-incidents/record-refund-attempt";
import { sendOpsAlert } from "@/lib/ops/alert";

// Extrait du handler webhook `payment_intent.succeeded` (cf
// app/api/stripe/webhook/route.tsx). Sortie en module séparé pour pouvoir
// tester en isolation, symétrique à `handle-payment-failed.ts` (commit
// 9482e5b). Le caller dans route.tsx orchestre les notifications producer
// (fetch consumer/producer/lines + email Resend + SMS Twilio via waitUntil)
// selon la valeur de retour ; cette fonction ne s'occupe QUE de la décision
// de transition + RPC résurrection + UPDATE éventuel + revalidate + audit
// log.
//
// IMPORTANT : aujourd'hui le webhook succeeded ne fait AUCUN UPDATE de
// statut sur le path nominal. L'order reste 'pending' après ce handler.
// Le passage 'pending' → 'confirmed' se fait plus tard, manuellement, par
// le producer via /api/orders/[id]/confirm/route.tsx (clic dans l'email).
// La résurrection 3DS-retry remet donc en 'pending' (pas 'confirmed') pour
// reproduire l'état d'avant le 3DS-fail et permettre au producer de suivre
// son flow normal de validation.
//
// Sémantique des 9 résultats :
//   - no_metadata : PI sans metadata.order_id (cas hors flow consumer,
//     ex. SetupIntent pour ensure-default-payment-method).
//   - order_not_found : DB miss (orphelin / RGPD anonymisé) — log warn,
//     ack 200 quand même.
//   - pending_to_notify : statut='pending' (cas nominal). Le caller doit
//     déclencher email + SMS producer.
//   - revived_to_notify : statut='cancelled' AND closure_reason=
//     'payment_failed', RPC revive_order_with_stock_check a réussi (lock +
//     check stock OK + check slot OK + décrément stock + UPDATE statut).
//     Le caller déclenche aussi email + SMS producer.
//   - revival_blocked_stock : RPC a retourné 'blocked_stock' (un item du
//     panier est en rupture entre temps), refund Stripe a réussi, UPDATE
//     closure_reason='revival_blocked_stock' posé. Caller déclenchera
//     email consumer (commit 3 du chantier).
//   - revival_blocked_slot : RPC a retourné 'blocked_slot' (slot saturé
//     entre temps ou supprimé), refund Stripe a réussi, UPDATE
//     closure_reason='revival_blocked_slot' posé. Caller déclenchera
//     email consumer (commit 3).
//   - revival_refund_failed : RPC blocked_* mais le refund Stripe a échoué.
//     Audit log poussé pour retry admin manuel (cf dette ouverte
//     "Cron retry-failed-refunds"). NE PAS UPDATE l'order : reste en
//     cancelled+payment_failed pour permettre un retry manuel.
//   - already_confirmed : statut ∈ {confirmed, ready, completed} →
//     idempotent webhook rejoué après confirm manuel producer. No-op.
//   - anomaly : statut ∈ {refunded} ou cancelled avec closure_reason
//     ≠ 'payment_failed' (consumer_cancel, producer_cancel, timeout, stock,
//     other), OU RPC a retourné une erreur/valeur inattendue. Cas patho-
//     logique : Stripe a encaissé mais l'order est terminée pour une autre
//     raison côté plateforme. Le caller insère une notification
//     webhook_anomaly pour traçabilité.
//
// Logs préfixés grep-able pour Vercel :
//   - [WEBHOOK_SUCCEEDED_FETCH_ERR]    : erreur PostgREST sur le SELECT.
//   - [WEBHOOK_SUCCEEDED_NO_ORDER]     : order absente en DB.
//   - [WEBHOOK_SUCCEEDED_REVIVAL]      : résurrection 3DS-retry effectuée.
//   - [WEBHOOK_SUCCEEDED_RPC_ERR]      : erreur PostgREST sur appel RPC.
//   - [WEBHOOK_SUCCEEDED_RPC_UNKNOWN]  : RPC retourne une valeur inattendue.
//   - [WEBHOOK_SUCCEEDED_REVIVAL_BLOCKED] : refund OK + UPDATE closure_reason.
//   - [WEBHOOK_SUCCEEDED_REFUND_FAILED]   : refund Stripe a throw, état préservé.
//   - [WEBHOOK_SUCCEEDED_ANOMALY]      : statut terminal incompatible.
//
// Audit logs (Phase 2 audit_logs payment events) :
//   - order_payment_succeeded            : path nominal pending_to_notify.
//   - order_revival_succeeded            : path revived_to_notify.
//   - order_revival_blocked_stock/_slot  : paths bloqués + refund OK.
//   - order_revival_refund_failed        : path bloqué + refund Stripe a échoué.

export type PaymentSucceededResult =
  | "no_metadata"
  | "order_not_found"
  | "pending_to_notify"
  | "revived_to_notify"
  | "revival_blocked_stock"
  | "revival_blocked_slot"
  | "revival_refund_failed"
  | "already_confirmed"
  | "anomaly";

export async function syncStripePaymentSucceeded(
  paymentIntent: Stripe.PaymentIntent,
  admin: SupabaseClient,
): Promise<{ result: PaymentSucceededResult; orderId: string | null }> {
  const orderId = paymentIntent.metadata?.order_id;
  if (!orderId) {
    return { result: "no_metadata", orderId: null };
  }

  const { data: order, error: fetchError } = await admin
    .from("orders")
    .select("id, statut, closure_reason, consumer_id")
    .eq("id", orderId)
    .maybeSingle();

  if (fetchError) {
    console.warn(
      `[WEBHOOK_SUCCEEDED_FETCH_ERR] order=${orderId} pi=${paymentIntent.id} error=${fetchError.message}`,
    );
    return { result: "order_not_found", orderId };
  }

  if (!order) {
    console.warn(
      `[WEBHOOK_SUCCEEDED_NO_ORDER] order=${orderId} pi=${paymentIntent.id} not found in DB`,
    );
    return { result: "order_not_found", orderId };
  }

  const currentStatus = order.statut as string;
  const currentReason = order.closure_reason as string | null;
  const consumerId = (order.consumer_id as string | null) ?? null;

  if (currentStatus === "pending") {
    // Cas nominal : count public dépend du statut → invalidation cache.
    await revalidatePublicStats({
      source: "stripe-payment-succeeded",
      orderId,
      extra: { step: "nominal" },
    });

    // Audit log forensique : payment réussi sur order pending. Trace
    // utile pour PCI DSS + dispute Stripe + reconstitution chronologie.
    await logPaymentEvent({
      eventType: "order_payment_succeeded",
      userId: consumerId,
      metadata: {
        order_id: orderId,
        payment_intent_id: paymentIntent.id,
      },
    });

    return { result: "pending_to_notify", orderId };
  }

  if (
    currentStatus === "confirmed" ||
    currentStatus === "ready" ||
    currentStatus === "completed"
  ) {
    // Idempotent : webhook rejoué après que le producer a déjà confirmé,
    // ou progression rapide. No-op silencieux (pas de re-notif, pas
    // d'audit log dupliqué).
    return { result: "already_confirmed", orderId };
  }

  if (currentStatus === "cancelled" && currentReason === "payment_failed") {
    // 🛡️ Résurrection 3DS-retry via RPC atomique
    // `revive_order_with_stock_check` (commit 6b4a835, migration
    // 20260427300000). La RPC lock l'order + check stock + check slot +
    // décrément + UPDATE statut, retournant un enum text.
    //
    // Préserve la symétrie de décrémentation côté DB :
    //   - création initiale : create_order_with_items décrémente.
    //   - annulation : trigger orders_restore_stock_after_cancel restaure.
    //   - résurrection : cette RPC re-décrémente (clos le bug détecté en
    //     validation prod après commit P1 49c0f1b).
    const { data: rpcResult, error: rpcError } = await admin.rpc(
      "revive_order_with_stock_check",
      { p_order_id: orderId },
    );

    if (rpcError) {
      console.warn(
        `[WEBHOOK_SUCCEEDED_RPC_ERR] order=${orderId} pi=${paymentIntent.id} error=${rpcError.message}`,
      );
      return { result: "anomaly", orderId };
    }

    if (rpcResult === "revived") {
      // Résurrection OK : le stock a été re-décrémenté atomiquement, l'order
      // est maintenant pending. Caller envoie email/SMS producer comme
      // dans le path nominal.
      await revalidatePublicStats({
        source: "stripe-payment-succeeded",
        orderId,
        extra: { step: "revived" },
      });
      await logPaymentEvent({
        eventType: "order_revival_succeeded",
        userId: consumerId,
        metadata: {
          order_id: orderId,
          payment_intent_id: paymentIntent.id,
        },
      });
      console.log(
        `[WEBHOOK_SUCCEEDED_REVIVAL] order=${orderId} pi=${paymentIntent.id} cancelled+payment_failed → pending`,
      );
      return { result: "revived_to_notify", orderId };
    }

    if (rpcResult === "blocked_stock" || rpcResult === "blocked_slot") {
      // Résurrection bloquée : la ressource (stock ou slot) a été prise
      // entre temps. Stripe a encaissé, on doit refund + email consumer
      // pour fermer proprement le flow.
      const blockedReason: "revival_blocked_stock" | "revival_blocked_slot" =
        rpcResult === "blocked_stock"
          ? "revival_blocked_stock"
          : "revival_blocked_slot";
      const auditEvent: "order_revival_blocked_stock" | "order_revival_blocked_slot" =
        rpcResult === "blocked_stock"
          ? "order_revival_blocked_stock"
          : "order_revival_blocked_slot";

      try {
        // T-408 idempotencyKey : `refund_${orderId}_revival` (context
        // discriminator distinct des paths admin / timeout / retry).
        // Defense-in-depth : la dédup webhook_events_processed évite déjà
        // un 2e refund sur rejouage Stripe, mais cohérence avec les autres
        // paths refund + protection contre purge erronée de la table dédup.
        await stripe.refunds.create(
          { payment_intent: paymentIntent.id },
          { idempotencyKey: `refund_${orderId}_revival` },
        );

        // UPDATE closure_reason pour drill-down UI consumer/admin.
        // statut reste 'cancelled' (l'order n'a jamais été engagée),
        // cancelled_at reste figé (déjà posé lors du payment_failed initial).
        await admin
          .from("orders")
          .update({ closure_reason: blockedReason })
          .eq("id", orderId);

        await logPaymentEvent({
          eventType: auditEvent,
          userId: consumerId,
          metadata: {
            order_id: orderId,
            payment_intent_id: paymentIntent.id,
            refund: "ok",
          },
        });

        console.warn(
          `[WEBHOOK_SUCCEEDED_REVIVAL_BLOCKED] order=${orderId} pi=${paymentIntent.id} reason=${blockedReason}`,
        );
        return {
          result:
            rpcResult === "blocked_stock"
              ? "revival_blocked_stock"
              : "revival_blocked_slot",
          orderId,
        };
      } catch (refundErr) {
        // Refund Stripe a échoué (réseau, idempotency conflict, account
        // issue). Le client est débité, on log l'incident pour retry
        // admin manuel + cron T-102.2.c. NE PAS UPDATE l'order : reste en
        // cancelled+payment_failed pour permettre un retry de la résurrection
        // après remédiation Stripe.
        console.error(
          `[WEBHOOK_SUCCEEDED_REFUND_FAILED] order=${orderId} pi=${paymentIntent.id} blocked=${rpcResult} error=${(refundErr as Error).message}`,
        );
        // Cluster B Phase 3 (bugs-P1-3) — alerte ops critique.
        await sendOpsAlert("[WEBHOOK_SUCCEEDED_REFUND_FAILED]", refundErr, {
          order_id: orderId,
          path: "revival",
          blocked_reason: rpcResult,
        });
        // T-102.2.b — double écriture refund_incidents + audit_logs (helper
        // fail-safe : ne throw pas, retourne null en cas d'échec write).
        const classified = classifyRefundError(refundErr);
        await recordRefundAttempt({
          orderId,
          kind: "revival",
          paymentIntentId: paymentIntent.id,
          consumerId,
          blockedReason: rpcResult,
          outcome: "failed",
          classified,
        });
        await logPaymentEvent({
          eventType: "order_revival_refund_failed",
          userId: consumerId,
          metadata: {
            order_id: orderId,
            payment_intent_id: paymentIntent.id,
            blocked_reason: rpcResult,
            refund_error: (refundErr as Error).message,
          },
        });
        return { result: "revival_refund_failed", orderId };
      }
    }

    // RPC retourne une valeur inattendue (théoriquement impossible mais
    // défensif). Bascule en anomaly pour que le caller insère une
    // notification webhook_anomaly et alerte admin.
    console.warn(
      `[WEBHOOK_SUCCEEDED_RPC_UNKNOWN] order=${orderId} pi=${paymentIntent.id} rpcResult=${String(rpcResult)}`,
    );
    return { result: "anomaly", orderId };
  }

  // Cas anomaly : refunded, ou cancelled avec autre closure_reason
  // (consumer_cancel, producer_cancel, timeout, stock, other, ou NULL).
  // Stripe a encaissé mais l'order est terminée côté plateforme pour une
  // raison incompatible — race condition rare, à investiguer par admin.
  console.warn(
    `[WEBHOOK_SUCCEEDED_ANOMALY] order=${orderId} pi=${paymentIntent.id} statut=${currentStatus} reason=${currentReason ?? "null"}`,
  );
  return { result: "anomaly", orderId };
}
