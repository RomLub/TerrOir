import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Helper unifié pour pousser un event de mutation admin sur la table
// public.producer_interests (leads producteurs). Symétrique aux helpers
// log-categorisation-event / log-auth-event / log-payment-event /
// log-review-event / log-legal-event.
//
// Cluster producer_interests : actions admin sur la table des leads
// producteurs. Tracé pour traçabilité forensique pré-launch (qui a changé
// le statut d'un lead, qui a supprimé un lead — utile pour reconstituer
// le funnel d'invitation si besoin).
//
// Métadonnées attendues côté call site :
//   - statut_changed : { interest_id, email, previous_statut, new_statut }
//     (email = snapshot anonymisable mais utile pour débugger, le user_id
//     côté audit log = l'admin qui a effectué l'action ; le lead lui-même
//     n'a pas de user_id avant onboarding)
//   - deleted        : { interest_id, email, source, statut, created_at }
//     (snapshot complet juste avant suppression — utile forensique si
//     suppression accidentelle d'un lead réel)
//
// Contrat fail-safe : un échec d'écriture audit ne doit JAMAIS casser le
// flow CRUD principal (cohérent avec les autres clusters). Toutes les
// erreurs sont swallow + console.warn.
//
// Service_role obligatoire : la table audit_logs n'a pas de policy INSERT,
// seul le bypass RLS du service_role permet d'écrire.

export const PRODUCER_INTERESTS_EVENT_TYPES = [
  "admin_producer_interest_statut_changed",
  "admin_producer_interest_deleted",
  // Chantier 3 (Leads) — CRM + funnel.
  "producer_interest_prospect_created",
  "producer_interest_step_advanced",
  "producer_interest_form_sent",
  "producer_interest_followup_logged",
  "producer_interest_assigned",
  "producer_interest_abandoned_manual",
  // Cron relances / abandon auto.
  "producer_interest_auto_relance_sent",
  "producer_interest_abandoned_auto",
] as const;

export type ProducerInterestsEventType =
  (typeof PRODUCER_INTERESTS_EVENT_TYPES)[number];

type LogProducerInterestsEventParams = {
  eventType: ProducerInterestsEventType;
  userId: string | null;
  metadata?: Record<string, unknown>;
};

export async function logProducerInterestsEvent(
  params: LogProducerInterestsEventParams,
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
