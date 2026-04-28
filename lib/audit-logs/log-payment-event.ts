import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Helper unifié pour pousser un event de paiement sensible dans
// public.audit_logs (cf. migration 20260427100000_create_audit_logs.sql).
//
// Symétrique à `lib/audit-logs/log-auth-event.ts` (Phase 1 audit_logs).
// Phase 2 audit_logs ouvre le périmètre payment_*/refund_* explicitement
// flaggé dans la migration initiale (lignes 16-19) : « simplement pousser
// un nouveau event_type dans la table ». Pas d'extension de schema DB
// nécessaire (event_type est `text`, pas un enum), seul le typing TS
// est étendu côté applicatif.
//
// Contrat fail-safe : un échec d'écriture audit ne doit JAMAIS casser le
// flow paiement principal. Un webhook Stripe doit ack 200 même si la
// table audit est down — sinon Stripe retry le webhook indéfiniment.
// Toutes les erreurs sont swallow + console.warn pour Vercel, jamais
// re-throw.
//
// Pas de fallback IP/UA via headers() Next.js : le call site principal
// est le webhook Stripe, qui est appelé par Stripe (IPs Stripe, peu
// pertinentes forensiquement). Le user_id vient de l'order.consumer_id
// quand disponible, null sinon. Si plus tard on instrumente des call
// sites browser (admin manual revival, etc.), on ajoutera l'option en
// prop facultative.
//
// Service_role obligatoire : la table audit_logs n'a pas de policy INSERT,
// seul le bypass RLS du service_role permet d'écrire. Cohérent avec
// log-auth-event (même contrat).

export type PaymentEventType =
  // Path nominal et failed (instrumentation rétroactive Phase 2).
  | "order_payment_succeeded"
  | "order_payment_failed"
  // Path résurrection 3DS-retry (P1 commit 49c0f1b).
  | "order_revival_succeeded"
  // Paths résurrection bloquée (chantier en cours).
  | "order_revival_blocked_stock"
  | "order_revival_blocked_slot"
  | "order_revival_refund_failed"
  // Path retry cron daily (chantier retry-failed-refunds — scope minimal
  // résurrection bloquée). Cron `/api/cron/retry-failed-refunds` retente
  // jusqu'à 3 fois les refunds bloqués sur le path résurrection. Idempotency
  // Stripe key dérivée de l'order_id + attempt pour empêcher double refund.
  // Sortie de boucle : `_retried_succeeded` (refund OK enfin) OU
  // `_retry_exhausted` (3 attempts épuisés, alerte admin via notifications
  // template='refund_retry_exhausted').
  | "order_refund_retried_succeeded"
  | "order_refund_retry_exhausted";

type LogPaymentEventParams = {
  eventType: PaymentEventType;
  // user_id optionnel : null pour les events où le consumer_id n'est pas
  // récupérable (order pas encore fetchée, orphelin). La table audit_logs
  // accepte user_id null (cf. migration 20260427100000 ligne 43).
  userId?: string | null;
  metadata?: Record<string, unknown>;
};

export async function logPaymentEvent(
  params: LogPaymentEventParams,
): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("audit_logs").insert({
      user_id: params.userId ?? null,
      event_type: params.eventType,
      metadata: params.metadata ?? {},
      ip_address: null,
      user_agent: null,
    });
    if (error) {
      console.warn(
        `AUDIT_LOG_INSERT_WARN event=${params.eventType} error=${error.message}`,
      );
    }
  } catch (err) {
    console.warn(
      `AUDIT_LOG_WRITE_WARN event=${params.eventType} error=${(err as Error).message}`,
    );
  }
}
