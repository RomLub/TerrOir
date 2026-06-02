import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Helper unifié pour pousser un event de pickup commande dans
// public.audit_logs. Symétrique à log-payment-event / log-categorisation-
// event / log-review-event.
//
// Cluster pickup : trace forensique exhaustive du flow de validation
// pickup côté producer (saisie du code TRR-* par le producer pour
// transitionner une commande confirmed → completed via la route
// /api/producer/orders/validate-pickup).
//
// 5 events couvrant les 2 chemins (preview GET + validation POST) plus
// le rate-limit :
//   - pickup_preview_ok       : GET ?code=X retourne preview OK
//   - pickup_preview_invalid  : GET échec (raison interne en metadata)
//   - pickup_validated        : POST {code} succès, transition effective
//   - pickup_attempt_invalid  : POST échec (raison interne en metadata)
//   - pickup_attempt_rate_limited : 10/min/producer dépassé
//
// Anti-info-leakage : metadata.reason distingue code_unknown vs
// wrong_producer (utile forensiquement pour détecter un producer A qui
// tenterait des codes de B), même si la réponse API publique est
// unifiée vers 404 générique.
//
// Contrat fail-safe : un échec d'écriture audit ne casse JAMAIS la route
// principale. Toutes les erreurs sont swallow + console.warn (cohérent
// avec les autres helpers log-*-event).

export const PICKUP_EVENT_TYPES = [
  "pickup_preview_ok",
  "pickup_preview_invalid",
  "pickup_validated",
  "pickup_attempt_invalid",
  "pickup_attempt_rate_limited",
] as const;

export type PickupEventType = (typeof PICKUP_EVENT_TYPES)[number];

type LogPickupEventParams = {
  eventType: PickupEventType;
  userId: string | null;
  metadata?: Record<string, unknown>;
};

export async function logPickupEvent(
  params: LogPickupEventParams,
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
