import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Helper de validation double opt-in pour product_stock_alerts.
// Appelé par GET /api/stock-alerts/confirm?token=xxx (route PUSH 4).
//
// Sémantique :
//   - Token vide / inexistant → invalid_token
//   - Token correspond à une row déjà unsubscribed → unsubscribed
//     (le user s'est désabonné après avoir cliqué confirm — on ne réactive
//     pas silencieusement, c'est conforme au respect du consentement)
//   - Token correspond à une row déjà confirmée → ok already_confirmed=true
//     (idempotent : double clic sur le lien email, ou re-clic plus tard)
//   - Token expiré (created_at + 7 jours) → expired
//   - Sinon UPDATE confirmed_at = now() → ok already_confirmed=false
//
// Pattern aligné lib/gms-prices/admin-write.ts : retour discriminé { ok }.
// Le caller (route GET) traduit en page de confirmation visuelle ou page
// d'erreur explicative (lien expiré / invalide).

export interface ConfirmAlertSuccess {
  id: string;
  product_id: string;
  already_confirmed: boolean;
}

export type ConfirmAlertError =
  | "invalid_token"
  | "expired"
  | "unsubscribed"
  | "db_error";

export type ConfirmAlertResult =
  | { ok: true; data: ConfirmAlertSuccess }
  | { ok: false; error: ConfirmAlertError };

// Expiration applicative du confirm_token. Aligné avec le cron purge daily
// (PUSH 4) qui DELETE confirmed_at IS NULL AND created_at < now() - 7d. Le
// helper fait le check côté lecture pour le cas où le user clique entre la
// fenêtre 7j+ et le passage du cron.
const CONFIRM_TOKEN_TTL_DAYS = 7;

export async function confirmStockAlert(
  admin: SupabaseClient,
  token: string,
): Promise<ConfirmAlertResult> {
  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, error: "invalid_token" };
  }

  const { data, error } = await admin
    .from("product_stock_alerts")
    .select("id, product_id, created_at, confirmed_at, unsubscribed_at")
    .eq("confirm_token", token)
    .maybeSingle();

  if (error) {
    console.error(`STOCK_ALERT_CONFIRM_ERROR error=${error.message}`);
    return { ok: false, error: "db_error" };
  }
  if (!data) {
    return { ok: false, error: "invalid_token" };
  }

  const row = data as {
    id: string;
    product_id: string;
    created_at: string;
    confirmed_at: string | null;
    unsubscribed_at: string | null;
  };

  if (row.unsubscribed_at !== null) {
    return { ok: false, error: "unsubscribed" };
  }

  // Idempotent : already confirmed → return ok with already_confirmed=true.
  if (row.confirmed_at !== null) {
    return {
      ok: true,
      data: {
        id: row.id,
        product_id: row.product_id,
        already_confirmed: true,
      },
    };
  }

  // Vérification expiration côté applicatif (le cron purge cleanup en async
  // ne tourne qu'une fois par jour).
  const createdAtMs = new Date(row.created_at).getTime();
  const ttlMs = CONFIRM_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
  if (Date.now() - createdAtMs > ttlMs) {
    return { ok: false, error: "expired" };
  }

  const { error: updateError } = await admin
    .from("product_stock_alerts")
    .update({ confirmed_at: new Date().toISOString() })
    .eq("id", row.id);

  if (updateError) {
    console.error(
      `STOCK_ALERT_CONFIRM_UPDATE_ERROR id=${row.id} error=${updateError.message}`,
    );
    return { ok: false, error: "db_error" };
  }

  return {
    ok: true,
    data: {
      id: row.id,
      product_id: row.product_id,
      already_confirmed: false,
    },
  };
}
