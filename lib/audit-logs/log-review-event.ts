import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Helper unifié pour pousser un event review/response dans public.audit_logs.
// Symétrique à log-auth-event / log-payment-event / log-admin-invite-event.
//
// Couvre les events cluster review producer-response (chantier 2026-05-06
// CGU 6.4 droit de réponse). Les events cluster modération avis consumer
// (publish/reject) ne sont pas émis aujourd'hui via audit_logs (la route
// /api/admin/reviews/[id]/moderate fait un UPDATE direct sans audit log) —
// ouverture future possible si besoin forensique élargi.
//
// Contrat fail-safe : un échec d'écriture audit ne doit JAMAIS casser le
// flow principal (la réponse producer doit être posée même si la table
// audit est down). Toutes les erreurs sont swallow + console.warn.
//
// Service_role obligatoire : la table audit_logs n'a pas de policy INSERT,
// seul le bypass RLS du service_role permet d'écrire.

export const REVIEW_EVENT_TYPES = [
  // Producer publie une nouvelle réponse à un avis (POST initial sur une
  // review sans réponse). userId = producer.user_id, metadata embarque
  // review_id, producer_id, response_length.
  "producer_response_published",
  // Producer édite sa réponse dans la fenêtre 24h. userId = producer.user_id,
  // metadata embarque review_id, producer_id, response_length, edited_at.
  "producer_response_updated",
  // Producer supprime sa réponse dans la fenêtre 24h. userId = producer.user_id,
  // metadata embarque review_id, producer_id.
  "producer_response_deleted_by_producer",
  // Admin supprime une réponse abusive (override de la lock 24h). userId
  // = admin.id, metadata embarque review_id, producer_id, response_length
  // (snapshot du texte supprimé pour traçabilité forensique légale).
  "producer_response_removed_by_admin",
  // Consumer toggle une pref notification. userId = consumer.id, metadata
  // embarque pref_key, new_value, previous_value (si row existait).
  "notification_preference_updated",
] as const;

export type ReviewEventType = (typeof REVIEW_EVENT_TYPES)[number];

type LogReviewEventParams = {
  eventType: ReviewEventType;
  userId: string | null;
  metadata?: Record<string, unknown>;
};

export async function logReviewEvent(
  params: LogReviewEventParams,
): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("audit_logs").insert({
      user_id: params.userId,
      event_type: params.eventType,
      metadata: params.metadata ?? {},
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
