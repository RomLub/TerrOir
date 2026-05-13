import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Helper unifié pour pousser un event de mutation admin sur la table
// `refund_incidents` (PR3 feature/admin-new-surfaces — gap surface admin
// /refund-incidents identifié à l'audit pré-launch AUDIT_ADMIN.md §6 P0 #3).
// Symétrique aux autres clusters log-*-event (log-payment-event,
// log-categorisation-event, log-pickup-event, log-producers-admin-event).
//
// Cluster refund-incidents : actions admin sur la table `refund_incidents`
// exercées par la nouvelle route /api/admin/refund-incidents/[id]/resolve
// (résolution manuelle d'un incident refund Stripe bloqué après épuisement
// des retries automatiques, ou avant retries quand intervention humaine
// est requise pour débloquer le flow).
//
// Métadonnées attendues côté call site :
//   - refund_incident_resolved_manually : {
//       incident_id, order_id, order_code (snapshot),
//       amount_cents (snapshot), previous_status, note
//     }
//
// Contrat fail-safe : un échec d'écriture audit ne doit JAMAIS casser le
// flow de mutation principal (UPDATE refund_incidents). Toutes les
// erreurs sont swallow + console.warn (cohérent avec les autres clusters).
//
// Service_role obligatoire : la table audit_logs n'a pas de policy INSERT,
// seul le bypass RLS du service_role permet d'écrire.

export const REFUND_INCIDENTS_EVENT_TYPES = [
  "refund_incident_resolved_manually",
] as const;

export type RefundIncidentsEventType =
  (typeof REFUND_INCIDENTS_EVENT_TYPES)[number];

type LogRefundIncidentsEventParams = {
  eventType: RefundIncidentsEventType;
  userId: string | null;
  metadata?: Record<string, unknown>;
};

export async function logRefundIncidentsEvent(
  params: LogRefundIncidentsEventParams,
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
