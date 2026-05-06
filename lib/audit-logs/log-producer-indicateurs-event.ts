import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Helper unifié pour pousser un event de rectification d'indicateurs
// score-carbone producteur dans public.audit_logs. Symétrique à
// log-pickup-event / log-payment-event.
//
// Cluster producer_indicateurs_* : trace forensique des modifications des 3
// enums score-carbone (mode_elevage, alimentation, densite_animale) depuis
// /ma-page producteur (T-232). Indispensable côté DGCCRF pour reconstituer
// rétrospectivement l'historique des déclarations d'un producteur.
//
// 1 event en MVP T-232 :
//   - producer_indicateurs_updated : rectification post-onboarding réussie
//
// Pas de capture PII : metadata contient uniquement les valeurs d'enums
// (publiques côté fiche producteur) + le booléen declaration_cochee. Pas de
// CP, lat/lng, email — cohérent doctrine T-200 r1.
//
// Fail-safe : un échec d'écriture audit ne casse JAMAIS la rectification.
// Toutes les erreurs sont swallow + console.warn.

export const PRODUCER_INDICATEURS_EVENT_TYPES = [
  "producer_indicateurs_updated",
] as const;

export type ProducerIndicateursEventType =
  (typeof PRODUCER_INDICATEURS_EVENT_TYPES)[number];

type LogProducerIndicateursEventParams = {
  eventType: ProducerIndicateursEventType;
  userId: string | null;
  metadata?: Record<string, unknown>;
};

export async function logProducerIndicateursEvent(
  params: LogProducerIndicateursEventParams,
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
