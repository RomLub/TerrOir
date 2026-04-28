import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GmsPriceFiliere } from "./fetch-active";

// Helpers d'écriture admin pour gms_prices — Phase B (interface /admin/gms-prices).
//
// Architecture : ces helpers prennent un SupabaseClient en argument (typé
// service_role côté appelant — cf. lib/supabase/admin.ts) plutôt que de
// l'instancier eux-mêmes. Avantages : (1) testabilité directe par injection
// d'un mock, sans avoir à mocker @/lib/supabase/admin ; (2) côté route, le
// même client peut servir aux pré-checks avant l'appel helper (économie d'un
// createClient).
//
// Toutes les fonctions trackent updated_by via la session admin (cf. migration
// 20260428100000 + arbitrage A4 : pas d'audit_logs pour le catalogue prix,
// colonne dédiée à la place).
//
// Pattern de retour : AdminWriteResult discriminé { ok: true; data } | { ok:
// false; error } pour aligner avec l'usage côté route (NextResponse.json).
// Pas de throw : log+return aligne fetch-active.ts et la convention codebase
// "résilience UI > propagation".

export interface GmsPriceCreateInput {
  slug: string;
  filiere: GmsPriceFiliere;
  libelle: string;
  description_courte: string | null;
  prix_gms_kg: number;
  prix_terroir_kg_min: number | null;
  prix_terroir_kg_max: number | null;
  prix_terroir_kg_moyen: number | null;
  mois_reference: string;
  source: string;
  source_url: string | null;
  ordre_affichage: number;
  notes_admin: string | null;
}

// Édition standard hors workflow mensuel (cf. arbitrage A3) :
//   - slug + filiere figés post-création (sécurité URLs publiques + clé regroupement)
//   - prix_* + mois_reference + active passent par d'autres workflows dédiés
//     (recordMonthlyUpdate, archiveGmsPrice)
export interface GmsPriceUpdateInput {
  libelle: string;
  description_courte: string | null;
  source: string;
  source_url: string | null;
  ordre_affichage: number;
  notes_admin: string | null;
}

// Workflow mise à jour mensuelle : prix + traçabilité history.
export interface GmsPriceMonthlyUpdateInput {
  prix_gms_kg: number;
  prix_terroir_kg_min: number | null;
  prix_terroir_kg_max: number | null;
  prix_terroir_kg_moyen: number | null;
  mois_reference: string;
  source: string;
  source_url: string | null;
}

export type AdminWriteResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export async function createGmsPrice(
  admin: SupabaseClient,
  input: GmsPriceCreateInput,
  adminUserId: string,
): Promise<AdminWriteResult<{ id: string }>> {
  const { data, error } = await admin
    .from("gms_prices")
    .insert({
      ...input,
      active: true,
      updated_by: adminUserId,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error(
      `GMS_PRICE_CREATE_ERROR slug=${input.slug} error=${error?.message ?? "no data"}`,
    );
    return { ok: false, error: error?.message ?? "Insert failed" };
  }
  return { ok: true, data: { id: (data as { id: string }).id } };
}

// Note updated_at : la table n'a pas de trigger BEFORE UPDATE, on set
// explicitement la colonne à chaque write pour conserver la sémantique
// "dernière modification" lisible côté admin.
export async function updateGmsPrice(
  admin: SupabaseClient,
  id: string,
  input: GmsPriceUpdateInput,
  adminUserId: string,
): Promise<AdminWriteResult<null>> {
  const { error } = await admin
    .from("gms_prices")
    .update({
      ...input,
      updated_by: adminUserId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) {
    console.error(`GMS_PRICE_UPDATE_ERROR id=${id} error=${error.message}`);
    return { ok: false, error: error.message };
  }
  return { ok: true, data: null };
}

// Soft delete (cf. arbitrage A5) : passe active à true/false, jamais hard
// DELETE. Préserve la FK gms_prices_history (ON DELETE CASCADE = destruction
// timeline historique sinon). Bouton "Archiver" / "Réactiver" côté UI.
export async function archiveGmsPrice(
  admin: SupabaseClient,
  id: string,
  active: boolean,
  adminUserId: string,
): Promise<AdminWriteResult<null>> {
  const { error } = await admin
    .from("gms_prices")
    .update({
      active,
      updated_by: adminUserId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) {
    console.error(
      `GMS_PRICE_ARCHIVE_ERROR id=${id} active=${active} error=${error.message}`,
    );
    return { ok: false, error: error.message };
  }
  return { ok: true, data: null };
}

// Workflow mise à jour mensuelle (atomicité applicative — cf. arbitrage A1) :
//   1. UPDATE live : si fail, return error, rien à rollback (pas encore
//      d'écriture history).
//   2. INSERT history : si fail, le live est déjà à jour côté public. On
//      log un warning grep-able (history manquante = retry manuel via
//      Supabase Studio possible, l'UNIQUE (reference_id, mois_reference)
//      rend l'opération idempotente). Return ok avec history_recorded=false
//      pour que la route puisse remonter le warning à l'admin.
//
// Justification ordre : UPDATE live d'abord vaut mieux que INSERT history
// d'abord, car le scénario inverse "history écrite mais pas de live MAJ"
// montrerait un mois historisé sans qu'il soit affiché publiquement —
// déroutant côté pédagogique.
export async function recordMonthlyUpdate(
  admin: SupabaseClient,
  id: string,
  input: GmsPriceMonthlyUpdateInput,
  adminUserId: string,
): Promise<AdminWriteResult<{ history_recorded: boolean }>> {
  const { error: updateError } = await admin
    .from("gms_prices")
    .update({
      prix_gms_kg: input.prix_gms_kg,
      prix_terroir_kg_min: input.prix_terroir_kg_min,
      prix_terroir_kg_max: input.prix_terroir_kg_max,
      prix_terroir_kg_moyen: input.prix_terroir_kg_moyen,
      mois_reference: input.mois_reference,
      source: input.source,
      source_url: input.source_url,
      updated_by: adminUserId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (updateError) {
    console.error(
      `GMS_PRICE_MONTHLY_LIVE_UPDATE_ERROR id=${id} error=${updateError.message}`,
    );
    return { ok: false, error: updateError.message };
  }

  const { error: historyError } = await admin
    .from("gms_prices_history")
    .insert({
      reference_id: id,
      prix_gms_kg: input.prix_gms_kg,
      prix_terroir_kg_moyen: input.prix_terroir_kg_moyen,
      mois_reference: input.mois_reference,
      source: input.source,
      source_url: input.source_url,
    });
  if (historyError) {
    console.warn(
      `GMS_PRICE_HISTORY_INSERT_WARN id=${id} mois=${input.mois_reference} error=${historyError.message}`,
    );
    return { ok: true, data: { history_recorded: false } };
  }

  return { ok: true, data: { history_recorded: true } };
}
