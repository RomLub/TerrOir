import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Helper unifié pour pousser un event de modération admin sur les reviews
// consumer (publish / reject). Symétrique à log-review-event (qui couvre
// les events cluster producer-response) et log-categorisation-event.
//
// Cluster review moderation : actions admin sur public.reviews via la page
// /admin/avis. Tracé pour traçabilité forensique pré-launch (qui a publié
// quel avis, qui a rejeté quel avis, quel était l'état précédent).
//
// Note : ce helper est distinct de log-review-event.ts (cluster
// producer_response_*) parce que la sémantique métier diffère :
//   - producer_response_* = actions producer/admin sur la réponse producer
//     (CGU 6.4 droit de réponse, fenêtre 24h)
//   - admin_review_*       = actions admin sur la review consumer
//     (modération initiale pre-publish, AUDIT_ADMIN § 1.2)
// Les categorize-event-type / labels.ts du lead consolideront les deux
// dans la catégorie "review" en sortie UI /audit-logs.
//
// Métadonnées attendues côté call site :
//   - admin_review_published : { review_id, producer_id, previous_statut }
//   - admin_review_rejected  : { review_id, producer_id, previous_statut }
//
// Contrat fail-safe : un échec d'écriture audit ne doit JAMAIS casser le
// flow de modération (cohérent avec les autres clusters). Toutes les
// erreurs sont swallow + console.warn.
//
// Service_role obligatoire : la table audit_logs n'a pas de policy INSERT,
// seul le bypass RLS du service_role permet d'écrire.

export const REVIEW_MODERATION_EVENT_TYPES = [
  // Admin publie une review pending (passe statut pending → published).
  // userId = admin.id, metadata embarque review_id, producer_id,
  // previous_statut.
  "admin_review_published",
  // Admin rejette une review (passe statut pending|published → rejected).
  // userId = admin.id, metadata embarque review_id, producer_id,
  // previous_statut.
  "admin_review_rejected",
] as const;

export type ReviewModerationEventType =
  (typeof REVIEW_MODERATION_EVENT_TYPES)[number];

type LogReviewModerationEventParams = {
  eventType: ReviewModerationEventType;
  userId: string | null;
  metadata?: Record<string, unknown>;
};

export async function logReviewModerationEvent(
  params: LogReviewModerationEventParams,
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
