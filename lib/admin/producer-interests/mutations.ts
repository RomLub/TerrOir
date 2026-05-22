import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FollowupChannel, FollowupDirection, LeadStatus } from "./types";

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

// ===========================================================================
// Chantier 3 (Leads) — helpers WRITE CRM. Tous service_role (RLS bypass).
// ===========================================================================

export interface CreateProspectInput {
  prenom: string | null;
  nom: string;
  email: string;
  telephone: string | null;
  nom_exploitation: string | null;
  commune: string | null;
  especes: string[] | null;
  message: string | null;
}

// Lead prospecté = repéré manuellement par l'admin (étape 1 frise prospecté),
// source 'invitation_directe' (la seule source non-publique). statut 'new'.
export async function createProspectLead(
  admin: SupabaseClient,
  input: CreateProspectInput,
): Promise<AdminWriteResult<{ id: string }>> {
  const { data, error } = await admin
    .from("producer_interests")
    .insert({
      prenom: input.prenom,
      nom: input.nom,
      email: input.email,
      telephone: input.telephone,
      nom_exploitation: input.nom_exploitation,
      commune: input.commune,
      especes: input.especes,
      message: input.message,
      statut: "new",
      source: "invitation_directe",
      current_step: 1,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error(`[PROSPECT_CREATE_ERROR] error=${error?.message}`);
    return { ok: false, error: error?.message ?? "insert failed" };
  }
  return { ok: true, data: { id: data.id as string } };
}

export async function setLeadStep(
  admin: SupabaseClient,
  id: string,
  step: number,
): Promise<AdminWriteResult<null>> {
  const { error } = await admin
    .from("producer_interests")
    .update({ current_step: step })
    .eq("id", id);
  if (error) {
    console.error(`[LEAD_STEP_ERROR] id=${id} error=${error.message}`);
    return { ok: false, error: error.message };
  }
  return { ok: true, data: null };
}

export async function assignLead(
  admin: SupabaseClient,
  id: string,
  assignedTo: string | null,
): Promise<AdminWriteResult<null>> {
  const { error } = await admin
    .from("producer_interests")
    .update({ assigned_to: assignedTo })
    .eq("id", id);
  if (error) {
    console.error(`[LEAD_ASSIGN_ERROR] id=${id} error=${error.message}`);
    return { ok: false, error: error.message };
  }
  return { ok: true, data: null };
}

export async function abandonLead(
  admin: SupabaseClient,
  id: string,
  reason: string,
  whenIso: string = new Date().toISOString(),
): Promise<AdminWriteResult<null>> {
  const { error } = await admin
    .from("producer_interests")
    .update({ abandoned_at: whenIso, abandoned_reason: reason })
    .eq("id", id);
  if (error) {
    console.error(`[LEAD_ABANDON_ERROR] id=${id} error=${error.message}`);
    return { ok: false, error: error.message };
  }
  return { ok: true, data: null };
}

// Pose le prefill_token + son expiration ET avance à l'étape 3 (formulaire
// envoyé) en une mutation. Le contact compte aussi comme une interaction
// (last_contact_at / first_contact_at gérés par logLeadFollowup côté route).
export async function setLeadPrefillTokenAndAdvance(
  admin: SupabaseClient,
  id: string,
  token: string,
  expiresAtIso: string,
): Promise<AdminWriteResult<null>> {
  const { error } = await admin
    .from("producer_interests")
    .update({
      prefill_token: token,
      prefill_token_expires_at: expiresAtIso,
      current_step: 3,
    })
    .eq("id", id);
  if (error) {
    console.error(`[LEAD_PREFILL_SET_ERROR] id=${id} error=${error.message}`);
    return { ok: false, error: error.message };
  }
  return { ok: true, data: null };
}

export interface LogFollowupInput {
  leadId: string;
  channel: FollowupChannel;
  direction: FollowupDirection;
  note: string | null;
  createdBy: string | null;
  isAutomatic?: boolean;
  relanceStep?: number | null;
  occurredAtIso?: string;
}

// Insère une interaction + met à jour last_contact_at (et first_contact_at si
// encore null). Le second UPDATE est gardé `.is('first_contact_at', null)`
// pour ne poser le premier contact qu'une fois.
export async function logLeadFollowup(
  admin: SupabaseClient,
  input: LogFollowupInput,
): Promise<AdminWriteResult<{ id: string }>> {
  const occurredAt = input.occurredAtIso ?? new Date().toISOString();
  const { data, error } = await admin
    .from("producer_interest_followups")
    .insert({
      lead_id: input.leadId,
      channel: input.channel,
      direction: input.direction,
      note: input.note,
      created_by: input.createdBy,
      is_automatic: input.isAutomatic ?? false,
      relance_step: input.relanceStep ?? null,
      occurred_at: occurredAt,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error(`[LEAD_FOLLOWUP_ERROR] lead=${input.leadId} error=${error?.message}`);
    return { ok: false, error: error?.message ?? "insert failed" };
  }

  await admin
    .from("producer_interests")
    .update({ last_contact_at: occurredAt })
    .eq("id", input.leadId);
  await admin
    .from("producer_interests")
    .update({ first_contact_at: occurredAt })
    .eq("id", input.leadId)
    .is("first_contact_at", null);

  return { ok: true, data: { id: data.id as string } };
}
