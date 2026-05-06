import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Helper unifié pour pousser un event de mutation admin sur les
// référentiels de catégorisation produit (T-130). Symétrique à
// log-auth-event / log-payment-event / log-review-event / log-legal-event.
//
// Cluster categorisation : actions admin sur 3 tables figées par T-220 PR-A
// (product_categories, animals, cuts). Tracé pour traçabilité forensique
// pré-launch (qui a renommé une catégorie, qui a supprimé un morceau).
//
// Métadonnées attendues côté call site :
//   - created  : { id, slug, name, sort_order } + animal_id pour cut
//   - updated  : { id, before: {...}, after: {...} } pour diff visible côté
//                page admin /audit-logs (T-082+)
//   - deleted  : { id, slug, name } + animal_id pour cut (snapshot juste
//                avant suppression — utile si erreur post-suppression
//                forensique)
//
// Contrat fail-safe : un échec d'écriture audit ne doit JAMAIS casser le
// flow CRUD principal (cohérent avec les autres clusters). Toutes les
// erreurs sont swallow + console.warn.
//
// Service_role obligatoire : la table audit_logs n'a pas de policy INSERT,
// seul le bypass RLS du service_role permet d'écrire.

export const CATEGORISATION_EVENT_TYPES = [
  // product_categories
  "admin_category_created",
  "admin_category_updated",
  "admin_category_deleted",
  // animals
  "admin_animal_created",
  "admin_animal_updated",
  "admin_animal_deleted",
  // cuts (scopés par animal_id, metadata embarque animal_id pour navigation
  // future depuis l'audit log)
  "admin_cut_created",
  "admin_cut_updated",
  "admin_cut_deleted",
] as const;

export type CategorisationEventType =
  (typeof CATEGORISATION_EVENT_TYPES)[number];

type LogCategorisationEventParams = {
  eventType: CategorisationEventType;
  userId: string | null;
  metadata?: Record<string, unknown>;
};

export async function logCategorisationEvent(
  params: LogCategorisationEventParams,
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
