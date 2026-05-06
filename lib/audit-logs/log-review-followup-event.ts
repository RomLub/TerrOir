import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Helper unifié pour pousser un event review-followup dans public.audit_logs.
// Symétrique à log-pickup-event / log-review-event / log-payment-event.
//
// Cluster review_followup : trace forensique du cron de relance review J+2
// et J+7 (cf. app/api/cron/review-followup/route.tsx). Les 4 events couvrent
// les 3 chemins observables côté cron :
//   - review_followup_sent_d2     : email J+2 envoyé OK
//   - review_followup_sent_d7     : email J+7 envoyé OK
//   - review_followup_skipped     : pas d'envoi (review existe déjà,
//                                   consumer email manquant, producer manquant,
//                                   send template fail). metadata.reason
//                                   discrimine le sous-cas.
//   - review_followup_dedup_blocked : marqueur DB déjà coché (re-run cron),
//                                     évite double-envoi (cf. migration
//                                     20260507200500 : colonnes
//                                     orders.review_followup_d{2,7}_sent_at).
//
// Discrimination J+2 vs J+7 : 2 events distincts (non un seul event avec
// metadata.day_offset) pour rester aligné avec le pattern existant côté
// other clusters (un event_type = un sous-flow forensiquement
// reconnaissable). UI admin filtres /audit-logs gagne 2 pills distinctes.
//
// Contrat fail-safe : un échec d'écriture audit ne casse JAMAIS le cron
// principal. Erreurs swallow + console.warn (cohérent avec les autres
// helpers log-*-event).

export const REVIEW_FOLLOWUP_EVENT_TYPES = [
  "review_followup_sent_d2",
  "review_followup_sent_d7",
  "review_followup_skipped",
  "review_followup_dedup_blocked",
] as const;

export type ReviewFollowupEventType =
  (typeof REVIEW_FOLLOWUP_EVENT_TYPES)[number];

type LogReviewFollowupEventParams = {
  eventType: ReviewFollowupEventType;
  userId: string | null;
  metadata?: Record<string, unknown>;
};

export async function logReviewFollowupEvent(
  params: LogReviewFollowupEventParams,
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
