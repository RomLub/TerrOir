import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Helper dédup applicative pour les webhooks Stripe (T-103, mini-chantier
// 2026-04-29). Migration : 20260429000000_webhook_events_processed.sql.
//
// Sémantique :
//   - INSERT exclusif sur webhook_events_processed (PK event_id). Si
//     l'INSERT réussit, on est le premier traitement de cet event_id →
//     return { alreadyProcessed: false }, le caller continue le handler.
//   - SQLSTATE 23505 (unique_violation) : event_id déjà présent =
//     rejouage Stripe → return { alreadyProcessed: true }, le caller
//     ack 200 sans rejouer les effets de bord.
//   - Toute autre erreur DB (réseau, permission, table manquante…) →
//     throw. Volontaire : Stripe retry (5xx), mais sans risque double
//     traitement car le retry réessaiera l'INSERT et on saura distinguer.
//     Préférable au "log+continue silencieux" qui pourrait causer double
//     envoi en cas de glitch DB transitoire.
//
// Pattern catch SQLSTATE 23505 aligné lib/producer-interests/upsert-interest.ts
// (PR #16) et lib/stock-alerts/create-alert.ts.
//
// Logs préfixés grep-able pour Vercel :
//   - [WEBHOOK_DEDUP_SKIP]      : event rejoué (alreadyProcessed: true).
//   - [WEBHOOK_DEDUP_INSERT_ERR]: erreur DB hors 23505, throw.

export interface CheckOrMarkResult {
  alreadyProcessed: boolean;
}

const PG_UNIQUE_VIOLATION = "23505";

export async function checkOrMarkProcessed(
  admin: SupabaseClient,
  eventId: string,
  eventType: string,
): Promise<CheckOrMarkResult> {
  const { error } = await admin
    .from("webhook_events_processed")
    .insert({ event_id: eventId, event_type: eventType });

  if (!error) {
    return { alreadyProcessed: false };
  }

  const code = (error as { code?: string } | null)?.code;
  if (code === PG_UNIQUE_VIOLATION) {
    console.log(
      `[WEBHOOK_DEDUP_SKIP] event_id=${eventId} event_type=${eventType}`,
    );
    return { alreadyProcessed: true };
  }

  console.error(
    `[WEBHOOK_DEDUP_INSERT_ERR] event_id=${eventId} event_type=${eventType} error=${error.message ?? "unknown"}`,
  );
  throw new Error(
    `webhook_events_processed insert failed: ${error.message ?? "unknown"}`,
  );
}
