import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Chantier 9 — events de la boîte mails admin (réponses sortantes depuis
// contact@). Fail-safe (swallow + warn). Service_role (audit_logs sans policy
// INSERT).

export const INBOUND_EMAIL_EVENT_TYPES = ["inbound_email_replied"] as const;

export type InboundEmailEventType = (typeof INBOUND_EMAIL_EVENT_TYPES)[number];

export async function logInboundEmailEvent(params: {
  eventType: InboundEmailEventType;
  userId: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
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
