import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Helper unifié pour pousser un event de mutation admin sur les producteurs
// (PR refactor/admin-pattern-uniform). Symétrique à log-categorisation-event,
// log-auth-event, log-payment-event, log-review-event, log-legal-event,
// log-pickup-event.
//
// Cluster producers-admin : actions admin sur la table `producers` exercées
// par les routes /api/admin/producers/* (hors `invite/` qui passe par
// log-admin-invite-event + log-auth-event pour l'historique forensique
// existant).
//
// Métadonnées attendues côté call site :
//   - statut_changed : { producer_id, previous_statut, new_statut,
//                       producer_name (snapshot), producer_slug (snapshot) }
//
// Contrat fail-safe : un échec d'écriture audit ne doit JAMAIS casser le
// flow CRUD principal (cohérent avec les autres clusters). Toutes les
// erreurs sont swallow + console.warn.
//
// Service_role obligatoire : la table audit_logs n'a pas de policy INSERT,
// seul le bypass RLS du service_role permet d'écrire.

export const PRODUCERS_ADMIN_EVENT_TYPES = [
  // Changement de statut producer par un admin (validation pending→active,
  // suspension, réactivation, etc.). Embarque previous + new pour diff
  // visible côté /audit-logs.
  "admin_producer_statut_changed",
  // Chantier 3 : demande de publication par le producteur lui-même (via la
  // RPC request_publication). Producer-initiated mais event de la table
  // producers → regroupé dans ce cluster pour la catégorie "Producteurs".
  "producer_publication_requested",
  // Chantier 3 : validation/refus admin de la certification bio (pose ou
  // retire bio_validated_at). Acte admin à valeur juridique (allégation AB).
  "admin_producer_bio_validated",
] as const;

export type ProducersAdminEventType =
  (typeof PRODUCERS_ADMIN_EVENT_TYPES)[number];

type LogProducersAdminEventParams = {
  eventType: ProducersAdminEventType;
  userId: string | null;
  metadata?: Record<string, unknown>;
};

export async function logProducersAdminEvent(
  params: LogProducersAdminEventParams,
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
