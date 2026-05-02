import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Helper UPSERT pour producer_interests (création initiale + mise à jour
// sur conflit email).
//
// Architecture : prend un SupabaseClient en argument (typé service_role
// côté appelant — cf. lib/supabase/admin.ts) plutôt que de l'instancier
// lui-même. Avantages : (1) testabilité par injection mock ;
// (2) cohérence avec lib/stock-alerts/create-alert.ts.
//
// Sémantique sur conflit UNIQUE (email) — cf. migration
// 20260428300000_producer_interests_unique_email.sql :
//   - Pas de row existant → INSERT, status='created' (statut='new',
//     source défaut 'formulaire_public', created_at défaut now()).
//   - Conflit 23505 → UPDATE granulaire des champs business uniquement
//     {prenom, nom, telephone, nom_exploitation, commune, message},
//     status='updated'. PRÉSERVE statut (workflow CRM admin), source
//     (canal d'origine, traçabilité funnel), created_at (analytics
//     funnel), especes (non saisi côté form public).
//   - Erreur DB autre que 23505 → ok:false avec error.message.
//
// Pas de .upsert() Supabase JS car le pattern catch+UPDATE permet un
// contrôle granulaire des champs UPDATE (impossible avec .upsert qui
// écrase tout le payload). Pattern aligné lib/stock-alerts/create-alert.ts.
//
// Pas de throw : log+return aligne convention codebase. Le caller (route
// API) traduit en NextResponse.json.

export interface UpsertProducerInterestInput {
  prenom: string;
  nom: string;
  email: string;
  telephone: string;
  nom_exploitation: string;
  commune: string;
  message: string | null;
}

export interface UpsertProducerInterestSuccess {
  id: string;
  status: "created" | "updated";
}

export type UpsertProducerInterestResult =
  | { ok: true; data: UpsertProducerInterestSuccess }
  | { ok: false; error: string };

// Normalisation email defense-in-depth (le caller doit aussi le faire côté
// validation Zod). Garantit que la contrainte UNIQUE matche entre runs.
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Code Postgres unique_violation (SQLSTATE 23505). Retourné par Supabase
// dans error.code lors d'un INSERT en conflit avec une contrainte UNIQUE.
const PG_UNIQUE_VIOLATION = "23505";

export async function upsertProducerInterest(
  admin: SupabaseClient,
  input: UpsertProducerInterestInput,
): Promise<UpsertProducerInterestResult> {
  const email = normalizeEmail(input.email);

  const { data: inserted, error: insertError } = await admin
    .from("producer_interests")
    .insert({
      prenom: input.prenom,
      nom: input.nom,
      email,
      telephone: input.telephone,
      nom_exploitation: input.nom_exploitation,
      commune: input.commune,
      message: input.message,
      statut: "new",
    })
    .select("id")
    .single();

  if (!insertError && inserted) {
    return {
      ok: true,
      data: {
        id: (inserted as { id: string }).id,
        status: "created",
      },
    };
  }

  // INSERT failed. Si conflit UNIQUE (email), on bascule sur UPDATE.
  // Sinon erreur DB générique.
  const errCode = (insertError as { code?: string } | null)?.code;
  if (errCode !== PG_UNIQUE_VIOLATION) {
    console.error(
      `[PRODUCER_INTEREST_UPSERT_INSERT_ERROR] email=${email} error=${insertError?.message ?? "unknown"}`,
    );
    return { ok: false, error: insertError?.message ?? "Insert failed" };
  }

  // Conflit UNIQUE → UPDATE granulaire des champs business.
  // PRÉSERVE statut, source, created_at, especes (non passés dans le payload).
  const { data: updated, error: updateError } = await admin
    .from("producer_interests")
    .update({
      prenom: input.prenom,
      nom: input.nom,
      telephone: input.telephone,
      nom_exploitation: input.nom_exploitation,
      commune: input.commune,
      message: input.message,
    })
    .ilike("email", email)
    .select("id")
    .single();

  if (updateError || !updated) {
    console.error(
      `[PRODUCER_INTEREST_UPSERT_UPDATE_ERROR] email=${email} error=${updateError?.message ?? "no data"}`,
    );
    return {
      ok: false,
      error: updateError?.message ?? "Update after conflict failed",
    };
  }

  return {
    ok: true,
    data: {
      id: (updated as { id: string }).id,
      status: "updated",
    },
  };
}
