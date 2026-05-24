import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Chantier 6 — events du cycle de vie des comptes administrateurs (page
// Admins, sous Gouvernance). Symétrique aux autres clusters log-*-event.
//
// Toutes les opérations sont réservées au super_admin (gardes RPC + route).
// `userId` = l'acteur (le super_admin qui exécute). Le compte cible figure
// dans metadata (target_user_id + email snapshot), jamais comme user_id de la
// ligne (qui trace QUI a agi, pas sur qui).
//
// Fail-safe : un échec d'écriture audit ne casse jamais l'opération (swallow
// + console.warn). Service_role obligatoire (audit_logs sans policy INSERT).

export const ADMIN_LIFECYCLE_EVENT_TYPES = [
  "admin_promoted",
  "admin_suspended",
  "admin_reactivated",
  "admin_revoked",
  "admin_privilege_changed",
] as const;

export type AdminLifecycleEventType =
  (typeof ADMIN_LIFECYCLE_EVENT_TYPES)[number];

type LogAdminLifecycleEventParams = {
  eventType: AdminLifecycleEventType;
  // L'acteur (super_admin qui exécute l'opération).
  userId: string | null;
  metadata?: Record<string, unknown>;
};

export async function logAdminLifecycleEvent(
  params: LogAdminLifecycleEventParams,
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
