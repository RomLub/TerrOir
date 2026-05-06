import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Helper unifié pour pousser un event admin "legal compliance" dans
// public.audit_logs. Symétrique log-auth-event / log-payment-event /
// log-review-event / log-admin-invite-event.
//
// Cluster legal_compliance : actions admin sur la conformité CGU (export
// CSV de la vue /admin/legal-compliance, pré-launch). Cluster séparé pour
// rester découplé du pipe auth (AUTH_EVENT_TYPES) en parallèle d'autres
// chantiers — la table audit_logs accepte un event_type libre côté DB.
//
// Contrat fail-safe : un échec d'écriture audit ne doit JAMAIS casser le
// flow principal (l'export CSV doit être livré même si audit_logs est
// down). Toutes les erreurs sont swallow + console.warn.
//
// Service_role obligatoire : la table audit_logs n'a pas de policy INSERT,
// seul le bypass RLS du service_role permet d'écrire.

export const LEGAL_COMPLIANCE_EVENT_TYPES = [
  // Admin a exporté la liste des users avec leur statut CGU. userId =
  // admin.id, metadata embarque status (filtre courant), search, count
  // (lignes exportées), truncated (true si capped à EXPORT_LIMIT).
  "admin_legal_compliance_exported",
  // T-083 — admin a lancé un lookup email sur /admin/audit-logs.
  // userId = admin.id, metadata { email_present: bool, masked_email,
  // user_resolved: bool, rate_limited: bool }. masked_email = "a***@b.fr"
  // pour traçabilité forensique sans tout déballer en clair dans le
  // metadata JSONB consultable côté admin (defense-in-depth contre admin
  // junior + leak de la table audit elle-même via dump SQL).
  "admin_audit_logs_email_lookup",
] as const;

export type LegalComplianceEventType =
  (typeof LEGAL_COMPLIANCE_EVENT_TYPES)[number];

type LogLegalEventParams = {
  eventType: LegalComplianceEventType;
  userId: string | null;
  metadata?: Record<string, unknown>;
};

export async function logLegalEvent(
  params: LogLegalEventParams,
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
