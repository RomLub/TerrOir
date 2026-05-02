import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateAlertToken } from "./tokens";

// Helper d'écriture pour product_stock_alerts (création + résurrection).
//
// Architecture : prend un SupabaseClient en argument (typé service_role côté
// appelant — cf. lib/supabase/admin.ts) plutôt que de l'instancier lui-même.
// Avantages : (1) testabilité par injection mock ; (2) côté route, le même
// client peut servir aux pré-checks (count rate limit, fetch product) avant
// l'appel helper. Pattern aligné lib/gms-prices/admin-write.ts.
//
// Sémantique :
//   - Pas d'alerte existante (product_id, email) → INSERT nouvelle row avec
//     tokens fraîchement générés. Retourne tokens pour envoi email confirm.
//   - Alerte existante ET active (confirmed_at NOT NULL, unsubscribed_at IS
//     NULL) → no-op silencieux. Retourne already_active=true sans regen
//     tokens (évite spam, route répond "déjà inscrit" sans re-envoyer email).
//   - Alerte existante ET inactive (non confirmée OU unsubscribed) →
//     "résurrection" : UPDATE row pour reset confirmed_at + unsubscribed_at
//     + notified_at à null + regen tokens + reset created_at (pour relancer
//     le compteur d'expiration confirm 7j et ne pas être purgée prématurément
//     par le cron). Retourne nouveaux tokens pour envoi email confirm.
//
// Pas de throw : log+return aligne convention codebase. Le caller (route
// API PUSH 4) traduit en NextResponse.json.

export interface CreateAlertInput {
  product_id: string;
  email: string;
  consumer_id: string | null;
}

export interface CreateAlertSuccess {
  id: string;
  already_active: boolean;
  // null si already_active (pas d'email confirm à renvoyer).
  confirm_token: string | null;
  // null si already_active. Sinon token frais (jamais renvoyé l'ancien
  // unsubscribe_token, même hors résurrection — sécurité).
  unsubscribe_token: string | null;
}

export type CreateAlertResult =
  | { ok: true; data: CreateAlertSuccess }
  | { ok: false; error: string };

// Normalisation email defense-in-depth (le caller doit aussi le faire côté
// validation Zod). Garantit que la PK UNIQUE matche entre runs.
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Code Postgres unique_violation (SQLSTATE 23505). Retourné par Supabase
// dans error.code lors d'un INSERT en conflit avec une contrainte UNIQUE.
const PG_UNIQUE_VIOLATION = "23505";

export async function createStockAlert(
  admin: SupabaseClient,
  input: CreateAlertInput,
): Promise<CreateAlertResult> {
  const email = normalizeEmail(input.email);
  const confirmToken = generateAlertToken();
  const unsubscribeToken = generateAlertToken();

  const { data: inserted, error: insertError } = await admin
    .from("product_stock_alerts")
    .insert({
      product_id: input.product_id,
      email,
      consumer_id: input.consumer_id,
      confirm_token: confirmToken,
      unsubscribe_token: unsubscribeToken,
    })
    .select("id")
    .single();

  if (!insertError && inserted) {
    return {
      ok: true,
      data: {
        id: (inserted as { id: string }).id,
        already_active: false,
        confirm_token: confirmToken,
        unsubscribe_token: unsubscribeToken,
      },
    };
  }

  // INSERT failed. Si conflit UNIQUE (product_id, email), on bascule sur
  // résurrection. Sinon erreur DB générique.
  const errCode = (insertError as { code?: string } | null)?.code;
  if (errCode !== PG_UNIQUE_VIOLATION) {
    console.error(
      `STOCK_ALERT_CREATE_ERROR product_id=${input.product_id} error=${insertError?.message ?? "unknown"}`,
    );
    return { ok: false, error: insertError?.message ?? "Insert failed" };
  }

  // Conflit UNIQUE → SELECT row existante pour décider already_active vs
  // résurrection.
  const { data: existing, error: selectError } = await admin
    .from("product_stock_alerts")
    .select("id, confirmed_at, unsubscribed_at")
    .eq("product_id", input.product_id)
    .ilike("email", email)
    .maybeSingle();

  if (selectError || !existing) {
    console.error(
      `STOCK_ALERT_CREATE_SELECT_ERROR product_id=${input.product_id} error=${selectError?.message ?? "no data"}`,
    );
    return {
      ok: false,
      error: selectError?.message ?? "Select after conflict failed",
    };
  }

  const row = existing as {
    id: string;
    confirmed_at: string | null;
    unsubscribed_at: string | null;
  };

  // Cas already_active : confirmé + pas unsubscribed → no-op silencieux.
  if (row.confirmed_at !== null && row.unsubscribed_at === null) {
    return {
      ok: true,
      data: {
        id: row.id,
        already_active: true,
        confirm_token: null,
        unsubscribe_token: null,
      },
    };
  }

  // Résurrection : UPDATE pour reset state + regen tokens + reset created_at
  // (relance compteur 7j d'expiration confirm).
  const { error: updateError } = await admin
    .from("product_stock_alerts")
    .update({
      consumer_id: input.consumer_id,
      confirmed_at: null,
      unsubscribed_at: null,
      notified_at: null,
      confirm_token: confirmToken,
      unsubscribe_token: unsubscribeToken,
      created_at: new Date().toISOString(),
    })
    .eq("id", row.id);

  if (updateError) {
    console.error(
      `STOCK_ALERT_CREATE_RESURRECT_ERROR id=${row.id} error=${updateError.message}`,
    );
    return { ok: false, error: updateError.message };
  }

  return {
    ok: true,
    data: {
      id: row.id,
      already_active: false,
      confirm_token: confirmToken,
      unsubscribe_token: unsubscribeToken,
    },
  };
}
