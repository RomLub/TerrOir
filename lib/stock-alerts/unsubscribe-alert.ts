import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Helper d'opt-out pour product_stock_alerts.
// Appelé par GET /api/stock-alerts/unsubscribe?token=xxx (route PUSH 4).
//
// Sémantique :
//   - Token vide / inexistant → invalid_token
//   - Token correspond à une row déjà unsubscribed → ok
//     already_unsubscribed=true (idempotent, pas d'erreur côté UX :
//     l'utilisateur peut cliquer plusieurs fois sur le lien dans son email).
//   - Sinon UPDATE unsubscribed_at = now() → ok already_unsubscribed=false
//
// Pas de TTL : le unsubscribe_token est permanent (lien dans tous les
// emails — convention RGPD universelle, l'utilisateur doit toujours pouvoir
// se désabonner sans recréer une alerte).

export interface UnsubscribeAlertSuccess {
  id: string;
  product_id: string;
  already_unsubscribed: boolean;
}

export type UnsubscribeAlertError = "invalid_token" | "db_error";

export type UnsubscribeAlertResult =
  | { ok: true; data: UnsubscribeAlertSuccess }
  | { ok: false; error: UnsubscribeAlertError };

export async function unsubscribeStockAlert(
  admin: SupabaseClient,
  token: string,
): Promise<UnsubscribeAlertResult> {
  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, error: "invalid_token" };
  }

  const { data, error } = await admin
    .from("product_stock_alerts")
    .select("id, product_id, unsubscribed_at")
    .eq("unsubscribe_token", token)
    .maybeSingle();

  if (error) {
    console.error(`STOCK_ALERT_UNSUBSCRIBE_ERROR error=${error.message}`);
    return { ok: false, error: "db_error" };
  }
  if (!data) {
    return { ok: false, error: "invalid_token" };
  }

  const row = data as {
    id: string;
    product_id: string;
    unsubscribed_at: string | null;
  };

  // Idempotent : déjà unsubscribed → no-op silencieux.
  if (row.unsubscribed_at !== null) {
    return {
      ok: true,
      data: {
        id: row.id,
        product_id: row.product_id,
        already_unsubscribed: true,
      },
    };
  }

  const { error: updateError } = await admin
    .from("product_stock_alerts")
    .update({ unsubscribed_at: new Date().toISOString() })
    .eq("id", row.id);

  if (updateError) {
    console.error(
      `STOCK_ALERT_UNSUBSCRIBE_UPDATE_ERROR id=${row.id} error=${updateError.message}`,
    );
    return { ok: false, error: "db_error" };
  }

  return {
    ok: true,
    data: {
      id: row.id,
      product_id: row.product_id,
      already_unsubscribed: false,
    },
  };
}
