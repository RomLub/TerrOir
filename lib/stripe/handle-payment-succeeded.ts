import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { revalidatePublicStats } from "@/lib/stats/revalidate";

// Extrait du handler webhook `payment_intent.succeeded` (cf
// app/api/stripe/webhook/route.tsx). Sortie en module séparé pour pouvoir
// tester en isolation, symétrique à `handle-payment-failed.ts` (commit
// 9482e5b). Le caller dans route.tsx orchestre les notifications producer
// (fetch consumer/producer/lines + email Resend + SMS Twilio via waitUntil)
// selon la valeur de retour ; cette fonction ne s'occupe QUE de la décision
// de transition + UPDATE éventuel + revalidate.
//
// IMPORTANT : aujourd'hui le webhook succeeded ne fait AUCUN UPDATE de
// statut sur le path nominal. L'order reste 'pending' après ce handler.
// Le passage 'pending' → 'confirmed' se fait plus tard, manuellement, par
// le producer via /api/orders/[id]/confirm/route.tsx (clic dans l'email).
// La résurrection 3DS-retry remet donc en 'pending' (pas 'confirmed') pour
// reproduire l'état d'avant le 3DS-fail et permettre au producer de suivre
// son flow normal de validation.
//
// Sémantique des 6 résultats :
//   - no_metadata : PI sans metadata.order_id (cas hors flow consumer,
//     ex. SetupIntent pour ensure-default-payment-method).
//   - order_not_found : DB miss (orphelin / RGPD anonymisé) — log warn,
//     ack 200 quand même.
//   - pending_to_notify : statut='pending' (cas nominal). Le caller doit
//     déclencher email + SMS producer.
//   - revived_to_notify : statut='cancelled' AND cancellation_reason=
//     'payment_failed' (cas client a retenté avec autre carte juste après
//     3DS-fail). UPDATE cancelled → pending + reset cancellation_reason
//     et cancelled_at à NULL (invariant `cancelled_at IS NULL ⟺ statut ∉
//     {cancelled, refunded}` préservé). Le caller déclenche aussi
//     email + SMS — premier moment où le producer doit savoir qu'il y a
//     une commande à honorer (rien envoyé lors du payment_failed initial).
//   - already_confirmed : statut ∈ {confirmed, ready, completed} →
//     idempotent webhook rejoué après confirm manuel producer. No-op.
//   - anomaly : statut ∈ {refunded} ou cancelled avec cancellation_reason
//     ≠ 'payment_failed' (consumer_cancel, producer_cancel, timeout, stock,
//     other). Cas pathologique : Stripe a encaissé mais l'order est
//     terminée pour une autre raison côté plateforme (race condition
//     race avec /orders/[id]/cancel, refund admin tardif, etc.). Le
//     caller insère une notification webhook_anomaly pour traçabilité.
//
// Logs préfixés grep-able pour Vercel (cohérent avec `handle-payment-failed`
// et le pattern projet) :
//   - [WEBHOOK_SUCCEEDED_FETCH_ERR] : erreur PostgREST sur le SELECT.
//   - [WEBHOOK_SUCCEEDED_NO_ORDER]  : order absente en DB.
//   - [WEBHOOK_SUCCEEDED_REVIVAL]   : résurrection 3DS-retry effectuée.
//   - [WEBHOOK_SUCCEEDED_ANOMALY]   : statut terminal incompatible.

export type PaymentSucceededResult =
  | "no_metadata"
  | "order_not_found"
  | "pending_to_notify"
  | "revived_to_notify"
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
    .select("id, statut, cancellation_reason")
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
  const currentReason = order.cancellation_reason as string | null;

  if (currentStatus === "pending") {
    // Cas nominal : count public dépend du statut → invalidation cache.
    await revalidatePublicStats();
    return { result: "pending_to_notify", orderId };
  }

  if (
    currentStatus === "confirmed" ||
    currentStatus === "ready" ||
    currentStatus === "completed"
  ) {
    // Idempotent : webhook rejoué après que le producer a déjà confirmé,
    // ou progression rapide. No-op silencieux (pas de re-notif).
    return { result: "already_confirmed", orderId };
  }

  if (currentStatus === "cancelled" && currentReason === "payment_failed") {
    // 🛡️ Résurrection 3DS-retry : cancelled → pending bypass volontaire de
    // la state machine. Cas spécifique (cancellation_reason='payment_failed'
    // = order jamais réellement engagée du point de vue producer/argent),
    // pas une transition générique. NE PAS étendre TRANSITIONS dans
    // stateMachine.ts — la state machine doit rester restrictive pour les
    // autres call sites (cancel route, refund, cron, admin).
    //
    // Reset cancellation_reason et cancelled_at à NULL : préserve l'invariant
    // `cancelled_at IS NULL ⟺ statut ∉ {cancelled, refunded}`. La trace de
    // l'incident reste accessible via Stripe Dashboard PI events + git
    // history + audit_logs Phase 2 (à venir).
    await admin
      .from("orders")
      .update({
        statut: "pending",
        cancellation_reason: null,
        cancelled_at: null,
      })
      .eq("id", orderId);

    await revalidatePublicStats();

    console.log(
      `[WEBHOOK_SUCCEEDED_REVIVAL] order=${orderId} pi=${paymentIntent.id} cancelled+payment_failed → pending`,
    );
    return { result: "revived_to_notify", orderId };
  }

  // Cas anomaly : refunded, ou cancelled avec autre cancellation_reason
  // (consumer_cancel, producer_cancel, timeout, stock, other, ou NULL).
  // Stripe a encaissé mais l'order est terminée côté plateforme pour une
  // raison incompatible — race condition rare, à investiguer par admin.
  console.warn(
    `[WEBHOOK_SUCCEEDED_ANOMALY] order=${orderId} pi=${paymentIntent.id} statut=${currentStatus} reason=${currentReason ?? "null"}`,
  );
  return { result: "anomaly", orderId };
}
