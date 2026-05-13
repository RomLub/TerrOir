import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeadStatus } from "./types";

// Helpers WRITE admin pour public.producer_interests — consommés par les
// API routes /api/admin/producer-interests/[id]/* . Pattern AdminWriteResult
// aligné avec lib/products/admin/categories.ts.
//
// Aucun statut "duplicate" possible ici (pas de slug unique côté update
// statut, pas de pré-check requis pour delete). La validation Zod du body
// se fait côté route ; ici on suppose les inputs valides.

export type AdminWriteResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface UpdateProducerInterestStatutInput {
  statut: LeadStatus;
}

export async function updateProducerInterestStatut(
  admin: SupabaseClient,
  id: string,
  input: UpdateProducerInterestStatutInput,
): Promise<AdminWriteResult<null>> {
  const { error } = await admin
    .from("producer_interests")
    .update({ statut: input.statut })
    .eq("id", id);
  if (error) {
    console.error(
      `[PRODUCER_INTEREST_UPDATE_STATUT_ERROR] id=${id} error=${error.message}`,
    );
    return { ok: false, error: error.message };
  }
  return { ok: true, data: null };
}

export async function deleteProducerInterest(
  admin: SupabaseClient,
  id: string,
): Promise<AdminWriteResult<null>> {
  const { error } = await admin
    .from("producer_interests")
    .delete()
    .eq("id", id);
  if (error) {
    console.error(
      `[PRODUCER_INTEREST_DELETE_ERROR] id=${id} error=${error.message}`,
    );
    return { ok: false, error: error.message };
  }
  return { ok: true, data: null };
}
