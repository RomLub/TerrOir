"use server";

// =============================================================================
// Server actions — gestion des créneaux producer
// =============================================================================
// Règles récurrentes (Phase 4) :
//   - createSlotRuleAction(prev, formData)       : via useFormState
//   - updateSlotRuleAction(ruleId, prev, formData) : via useFormState + bind
//   - toggleSlotRuleActiveAction(ruleId)         : direct call
//   - deleteSlotRuleAction(ruleId)               : direct call + guard orders
//
// Ponctuels :
//   - createAdHocSlotAction(prev, formData)      : via useFormState
//   - deleteAdHocSlotAction(slotId)              : direct call + guard orders
//   - deleteAdHocOpeningAction(slotIds)          : delete groupé d'une
//                                                  ouverture ponctuelle RDV
//
// Indisponibilités (chantier ADR-0016, 2026-05-28) — SOURCE DE VÉRITÉ :
//   - createUnavailabilitiesAction(prev, formData) : pose 1..N indispos
//                                                    (jour entier, raison?)
//   - deleteUnavailabilityAction(id)               : supprime 1 indispo +
//                                                    régénération ciblée
//                                                    du jour libéré
//
// `excluded_at` est un ARTEFACT INTERNE : posé/retiré exclusivement par
// `createUnavailabilities` / `deleteUnavailability`. Aucune autre action UI
// ne touche `excluded_at` (ADR-0016 PS).
//
// Ownership check systématique : match producers.user_id = session.id via
// service_role (slot_rules n'a pas de relation user directe, on passe par
// producers). RLS "owner all" sur slot_rules sert aussi de défense en
// profondeur côté DB.
// =============================================================================

import { revalidatePath } from "next/cache";
import { TZDate } from "@date-fns/tz";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  generateSlotsForProducer,
  invalidateProducer,
} from "@/lib/slots/generate";
import {
  adHocSlotSchema,
  slotRuleSchema,
  timeToMinutes,
} from "@/lib/slots/validators";
import { sliceWindow } from "@/lib/slots/slice-window";
import { createUnavailabilities } from "@/lib/unavailabilities/create";
import { deleteUnavailability } from "@/lib/unavailabilities/delete";
import type {
  CreateUnavailabilitiesResult,
  DeleteUnavailabilityResult,
} from "@/lib/unavailabilities/types";

const TZ_PARIS = "Europe/Paris";

export type SlotRuleActionState = {
  error?: string;
  success?: boolean;
};

async function resolveProducerId(
  userId: string,
): Promise<{ id: string } | { error: string }> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("producers")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Profil producteur introuvable." };
  return { id: data.id as string };
}

function parseRuleInput(formData: FormData) {
  return slotRuleSchema.safeParse({
    days_of_week: formData.getAll("days_of_week").map(String),
    periodicity_weeks: formData.get("periodicity_weeks") ?? 1,
    start_time: formData.get("start_time"),
    end_time: formData.get("end_time"),
    mode: formData.get("mode") ?? "rdv",
    slot_duration_minutes: formData.get("slot_duration_minutes") ?? undefined,
    capacity_per_slot: formData.get("capacity_per_slot"),
  });
}

// Durée finale stockée selon le mode : 'libre' ⇒ amplitude horaire (generate.ts
// produit alors 1 slot/jour) ; 'rdv' ⇒ la durée de tranche validée.
function resolveDuration(input: {
  mode: string;
  start_time: string;
  end_time: string;
  slot_duration_minutes?: number;
}): number {
  if (input.mode === "libre") {
    return timeToMinutes(input.end_time) - timeToMinutes(input.start_time);
  }
  return input.slot_duration_minutes as number;
}

export async function createSlotRuleAction(
  _prev: SlotRuleActionState,
  formData: FormData,
): Promise<SlotRuleActionState> {
  const session = await getSessionUser();
  if (!session) return { error: "Non authentifié" };

  const producerRes = await resolveProducerId(session.id);
  if ("error" in producerRes) return { error: producerRes.error };

  const parsed = parseRuleInput(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  }

  const admin = createSupabaseAdminClient();
  const { error: insertError } = await admin.from("slot_rules").insert({
    producer_id: producerRes.id,
    ...parsed.data,
    slot_duration_minutes: resolveDuration(parsed.data),
    active: true,
  });

  if (insertError) {
    console.error(
      `CREATE_SLOT_RULE_ERROR producer_id=${producerRes.id} error=${insertError.message}`,
    );
    return { error: "Impossible de créer la règle." };
  }

  invalidateProducer(producerRes.id);
  try {
    await generateSlotsForProducer(admin, producerRes.id, 90);
  } catch (err) {
    console.warn("GENERATE_SLOTS_WARN after create:", err);
  }

  revalidatePath("/creneaux");
  return { success: true };
}

export async function updateSlotRuleAction(
  ruleId: string,
  _prev: SlotRuleActionState,
  formData: FormData,
): Promise<SlotRuleActionState> {
  const session = await getSessionUser();
  if (!session) return { error: "Non authentifié" };

  const producerRes = await resolveProducerId(session.id);
  if ("error" in producerRes) return { error: producerRes.error };

  const parsed = parseRuleInput(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  }

  const admin = createSupabaseAdminClient();

  // Ownership guard : la rule doit appartenir au producer de la session.
  const { data: existing } = await admin
    .from("slot_rules")
    .select("id, producer_id")
    .eq("id", ruleId)
    .maybeSingle();
  if (!existing || existing.producer_id !== producerRes.id) {
    return { error: "Règle introuvable." };
  }

  const { error: updateError } = await admin
    .from("slot_rules")
    .update({
      ...parsed.data,
      slot_duration_minutes: resolveDuration(parsed.data),
    })
    .eq("id", ruleId);

  if (updateError) {
    console.error(
      `UPDATE_SLOT_RULE_ERROR rule_id=${ruleId} error=${updateError.message}`,
    );
    return { error: "Impossible de mettre à jour la règle." };
  }

  invalidateProducer(producerRes.id);
  try {
    await generateSlotsForProducer(admin, producerRes.id, 90);
  } catch (err) {
    console.warn("GENERATE_SLOTS_WARN after update:", err);
  }

  revalidatePath("/creneaux");
  return { success: true };
}

export async function toggleSlotRuleActiveAction(
  ruleId: string,
): Promise<{ success: true; active: boolean } | { error: string }> {
  const session = await getSessionUser();
  if (!session) return { error: "Non authentifié" };

  const producerRes = await resolveProducerId(session.id);
  if ("error" in producerRes) return { error: producerRes.error };

  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin
    .from("slot_rules")
    .select("id, producer_id, active")
    .eq("id", ruleId)
    .maybeSingle();
  if (!existing || existing.producer_id !== producerRes.id) {
    return { error: "Règle introuvable." };
  }

  const nextActive = !(existing.active as boolean);

  const { error: updateError } = await admin
    .from("slot_rules")
    .update({ active: nextActive })
    .eq("id", ruleId);
  if (updateError) {
    console.error(
      `TOGGLE_SLOT_RULE_ERROR rule_id=${ruleId} error=${updateError.message}`,
    );
    return { error: "Impossible de changer l'état de la règle." };
  }

  // Symétrie côté slots matérialisés : si on désactive la rule, on désactive
  // aussi les slots futurs (y compris ceux avec orders — snapshot d'order
  // reste intact via date_retrait/heure_retrait). Si on réactive, on rouvre
  // les slots futurs et on regénère pour couvrir les jours manquants.
  const nowIso = new Date().toISOString();
  const { error: slotsUpdateError } = await admin
    .from("slots")
    .update({ active: nextActive })
    .eq("rule_id", ruleId)
    .gt("starts_at", nowIso);
  if (slotsUpdateError) {
    console.warn(
      `TOGGLE_SLOTS_SYNC_WARN rule_id=${ruleId} error=${slotsUpdateError.message}`,
    );
  }

  invalidateProducer(producerRes.id);
  if (nextActive) {
    try {
      await generateSlotsForProducer(admin, producerRes.id, 90);
    } catch (err) {
      console.warn("GENERATE_SLOTS_WARN after toggle on:", err);
    }
  }

  revalidatePath("/creneaux");
  return { success: true, active: nextActive };
}

export async function deleteSlotRuleAction(
  ruleId: string,
): Promise<{ success: true } | { error: string }> {
  const session = await getSessionUser();
  if (!session) return { error: "Non authentifié" };

  const producerRes = await resolveProducerId(session.id);
  if ("error" in producerRes) return { error: producerRes.error };

  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin
    .from("slot_rules")
    .select("id, producer_id")
    .eq("id", ruleId)
    .maybeSingle();
  if (!existing || existing.producer_id !== producerRes.id) {
    return { error: "Règle introuvable." };
  }

  // Guard : pas de hard-delete si des orders pointent sur des slots issus de
  // cette rule (FK orders.slot_id sans CASCADE → DELETE échouerait). Le
  // producer doit désactiver plutôt pour préserver l'historique comptable.
  const { data: slotIds } = await admin
    .from("slots")
    .select("id")
    .eq("rule_id", ruleId);

  if (slotIds && slotIds.length > 0) {
    const ids = slotIds.map((s) => s.id as string);
    const { count: orderCount } = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .in("slot_id", ids);

    if ((orderCount ?? 0) > 0) {
      return {
        error:
          "Cette règle a été utilisée pour des commandes. Désactivez-la plutôt pour préserver l'historique.",
      };
    }
  }

  const { error: deleteError } = await admin
    .from("slot_rules")
    .delete()
    .eq("id", ruleId);
  if (deleteError) {
    console.error(
      `DELETE_SLOT_RULE_ERROR rule_id=${ruleId} error=${deleteError.message}`,
    );
    return { error: "Impossible de supprimer la règle." };
  }

  invalidateProducer(producerRes.id);
  revalidatePath("/creneaux");
  return { success: true };
}

// =============================================================================
// Créneaux ponctuels + exceptions manuelles
// =============================================================================

// Convertit un datetime-local "YYYY-MM-DDTHH:MM" (envoyé par l'input HTML)
// en ISO UTC timestamptz, interprété en Europe/Paris. Le datetime-local n'a
// pas de TZ côté DOM ; on l'ancre explicitement à Paris pour stocker en DB.
function localDateTimeToParisUTC(local: string): string {
  const [datePart, timePart = "00:00"] = local.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = timePart.split(":").map(Number);
  return new TZDate(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0, TZ_PARIS)
    .toISOString();
}

export async function createAdHocSlotAction(
  _prev: SlotRuleActionState,
  formData: FormData,
): Promise<SlotRuleActionState> {
  const session = await getSessionUser();
  if (!session) return { error: "Non authentifié" };

  const producerRes = await resolveProducerId(session.id);
  if ("error" in producerRes) return { error: producerRes.error };

  const parsed = adHocSlotSchema.safeParse({
    start_at: formData.get("start_at"),
    end_at: formData.get("end_at"),
    mode: formData.get("mode") ?? "libre",
    slot_duration_minutes: formData.get("slot_duration_minutes") ?? undefined,
    capacity_per_slot: formData.get("capacity_per_slot"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  }

  const startsIso = localDateTimeToParisUTC(parsed.data.start_at);
  const endsIso = localDateTimeToParisUTC(parsed.data.end_at);

  // 'libre' ⇒ un seul créneau couvrant la plage. 'rdv' ⇒ découpage serveur en
  // tranches (helper pur sliceWindow, mêmes règles que generate.ts).
  const rows =
    parsed.data.mode === "rdv"
      ? sliceWindow(
          new Date(startsIso).getTime(),
          new Date(endsIso).getTime(),
          parsed.data.slot_duration_minutes as number,
          Date.now(),
        ).map((s) => ({
          producer_id: producerRes.id,
          rule_id: null,
          starts_at: new Date(s.startsAtMs).toISOString(),
          ends_at: new Date(s.endsAtMs).toISOString(),
          capacity_per_slot: parsed.data.capacity_per_slot,
          active: true,
        }))
      : [
          {
            producer_id: producerRes.id,
            rule_id: null,
            starts_at: startsIso,
            ends_at: endsIso,
            capacity_per_slot: parsed.data.capacity_per_slot,
            active: true,
          },
        ];

  if (rows.length === 0) {
    return {
      error: "Aucun créneau à créer (plage trop courte ou déjà passée).",
    };
  }

  const admin = createSupabaseAdminClient();
  // upsert idempotent (comme generate.ts) : un horaire déjà matérialisé n'est
  // pas dupliqué (contrainte unique producer_id, starts_at).
  const { error: insertError } = await admin.from("slots").upsert(rows, {
    onConflict: "producer_id,starts_at",
    ignoreDuplicates: true,
  });

  if (insertError) {
    console.error(
      `CREATE_ADHOC_SLOT_ERROR producer_id=${producerRes.id} error=${insertError.message}`,
    );
    return { error: "Impossible de créer le créneau ponctuel." };
  }

  revalidatePath("/creneaux");
  return { success: true };
}

export async function deleteAdHocSlotAction(
  slotId: string,
): Promise<{ success: true } | { error: string }> {
  const session = await getSessionUser();
  if (!session) return { error: "Non authentifié" };

  const producerRes = await resolveProducerId(session.id);
  if ("error" in producerRes) return { error: producerRes.error };

  const admin = createSupabaseAdminClient();
  // Guard : slot doit exister, appartenir au producer ET être ponctuel
  // (rule_id NULL). On ne DELETE jamais un slot issu d'une rule — ceux-ci
  // se gèrent via toggle/delete de la rule parente.
  const { data: slot } = await admin
    .from("slots")
    .select("id, producer_id, rule_id")
    .eq("id", slotId)
    .maybeSingle();
  if (!slot || slot.producer_id !== producerRes.id) {
    return { error: "Créneau introuvable." };
  }
  if (slot.rule_id !== null) {
    return {
      error:
        "Ce créneau provient d'une règle récurrente. Gérez-le via la règle.",
    };
  }

  // Guard orders : FK sans CASCADE → la DELETE échouerait si un order pointe
  // dessus. Pré-check avec message UX propre.
  const { count: orderCount } = await admin
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("slot_id", slotId);
  if ((orderCount ?? 0) > 0) {
    return {
      error:
        "Ce créneau a été réservé pour une commande. Annulez-la avant de le supprimer.",
    };
  }

  const { error: deleteError } = await admin
    .from("slots")
    .delete()
    .eq("id", slotId);
  if (deleteError) {
    console.error(
      `DELETE_ADHOC_SLOT_ERROR slot_id=${slotId} error=${deleteError.message}`,
    );
    return { error: "Impossible de supprimer le créneau." };
  }

  revalidatePath("/creneaux");
  return { success: true };
}

// Suppression groupée d'une ouverture ponctuelle (mode rendez-vous → N slots).
// Le calendrier passe les ids du groupe. Gardes par slot : ad-hoc (rule_id
// NULL) + ownership + aucune commande liée.
export async function deleteAdHocOpeningAction(
  slotIds: string[],
): Promise<{ success: true; deleted: number } | { error: string }> {
  const session = await getSessionUser();
  if (!session) return { error: "Non authentifié" };

  const producerRes = await resolveProducerId(session.id);
  if ("error" in producerRes) return { error: producerRes.error };

  if (!slotIds || slotIds.length === 0) return { success: true, deleted: 0 };

  const admin = createSupabaseAdminClient();

  const { data: slots } = await admin
    .from("slots")
    .select("id, producer_id, rule_id")
    .in("id", slotIds);
  const owned = (slots ?? []).filter(
    (s) => s.producer_id === producerRes.id && s.rule_id === null,
  );
  if (owned.length !== slotIds.length) {
    return {
      error:
        "Créneau introuvable ou issu d'une ouverture régulière (gérez-la via la règle).",
    };
  }

  const { count: orderCount } = await admin
    .from("orders")
    .select("id", { count: "exact", head: true })
    .in("slot_id", slotIds);
  if ((orderCount ?? 0) > 0) {
    return {
      error:
        "Un créneau de cette ouverture a été réservé. Annulez la commande avant de supprimer.",
    };
  }

  const { error: deleteError } = await admin
    .from("slots")
    .delete()
    .in("id", slotIds);
  if (deleteError) {
    console.error(
      `DELETE_ADHOC_OPENING_ERROR producer_id=${producerRes.id} error=${deleteError.message}`,
    );
    return { error: "Impossible de supprimer l'ouverture ponctuelle." };
  }

  revalidatePath("/creneaux");
  return { success: true, deleted: slotIds.length };
}

// =============================================================================
// Indisponibilités producteur (option B — chantier ADR-0016, 2026-05-28)
// =============================================================================
// Source de vérité = table `unavailabilities` (cf. lib/unavailabilities/*).
// Ces actions sont les SEULS chemins UI qui mutent indirectement
// `slots.excluded_at` (effet de bord display, retiré symétriquement par
// `deleteUnavailability`). Toute autre mutation directe d'`excluded_at` a
// été supprimée en PR #2 (cf. ADR-0016 PS).
//
// Garde anti-régression : si une requête arrive sur un jour à commandes
// actives, `createUnavailabilities` retourne { code: 'BLOCKING_ORDERS',
// blocking_orders } — l'UI affiche un message d'erreur explicite, sans
// flow d'annulation interne (décision produit : geste délibéré par
// /commandes pour ne pas banaliser la rupture d'engagement client).
// =============================================================================

export async function createUnavailabilitiesAction(
  _prev: CreateUnavailabilitiesResult | null,
  formData: FormData,
): Promise<CreateUnavailabilitiesResult> {
  const session = await getSessionUser();
  if (!session)
    return { error: "Non authentifié", code: "INVALID_INPUT" };

  const producerRes = await resolveProducerId(session.id);
  if ("error" in producerRes)
    return { error: producerRes.error, code: "INVALID_INPUT" };

  // FormData : dates[] = ["YYYY-MM-DD", ...], raison (optionnelle).
  const dates = formData.getAll("dates").map(String);
  const rawRaison = formData.get("raison");
  const raison =
    typeof rawRaison === "string" && rawRaison.length > 0 ? rawRaison : null;

  const result = await createUnavailabilities({
    producerId: producerRes.id,
    dates,
    raison,
    createdBy: session.id,
  });

  if ("success" in result && result.success) {
    revalidatePath("/creneaux");
  }
  return result;
}

export async function deleteUnavailabilityAction(
  unavailabilityId: string,
): Promise<DeleteUnavailabilityResult> {
  const session = await getSessionUser();
  if (!session)
    return { error: "Non authentifié", code: "INVALID_INPUT" };

  const producerRes = await resolveProducerId(session.id);
  if ("error" in producerRes)
    return { error: producerRes.error, code: "INVALID_INPUT" };

  const result = await deleteUnavailability({
    producerId: producerRes.id,
    unavailabilityId,
  });

  if ("success" in result && result.success) {
    revalidatePath("/creneaux");
  }
  return result;
}
