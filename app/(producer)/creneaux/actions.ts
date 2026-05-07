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
// Ponctuels + exceptions (Phase "Créneaux ponctuels + exceptions") :
//   - createAdHocSlotAction(prev, formData)      : via useFormState
//   - deleteAdHocSlotAction(slotId)              : direct call + guard orders
//   - excludeSlotAction(slotId)                  : direct call + guard active orders
//   - unexcludeSlotAction(slotId)                : direct call
//   - bulkExcludeRangeAction(prev, formData)     : via useFormState, skip slots
//                                                  avec active orders (non-bloquant)
//
// Ownership check systématique : match producers.user_id = session.id via
// service_role (slot_rules n'a pas de relation user directe, on passe par
// producers). RLS "owner all" sur slot_rules sert aussi de défense en
// profondeur côté DB.
//
// Après chaque mutation rules : invalidateProducer(producerId) +
// generateSlotsForProducer(90) pour que l'UI consumer reflète immédiatement
// les changements (nouveaux slots matérialisés).
//
// NOTE : Phase 2 UI (à venir) consommera ces actions via 2 nouvelles
// sections dans /creneaux/page.tsx (Créneaux ponctuels + Exceptions).
// =============================================================================

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { TZDate } from "@date-fns/tz";
import { addDays } from "date-fns";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  generateSlotsForProducer,
  invalidateProducer,
} from "@/lib/slots/generate";
import { slotRuleSchema } from "@/lib/slots/validators";
import { ACTIVE_ORDER_STATUTS } from "@/lib/orders/stateMachine";

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
    periodicity_weeks: formData.get("periodicity_weeks"),
    start_time: formData.get("start_time"),
    end_time: formData.get("end_time"),
    slot_duration_minutes: formData.get("slot_duration_minutes"),
    capacity_per_slot: formData.get("capacity_per_slot"),
  });
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
    .update({ ...parsed.data })
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

// Convertit une date "YYYY-MM-DD" en timestamptz UTC, minuit Europe/Paris.
function dateStrToParisUTC(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new TZDate(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, TZ_PARIS).toISOString();
}

const adHocSlotSchema = z
  .object({
    start_at: z
      .string()
      .regex(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,
        "Format attendu : YYYY-MM-DDTHH:MM",
      ),
    end_at: z
      .string()
      .regex(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,
        "Format attendu : YYYY-MM-DDTHH:MM",
      ),
    capacity_per_slot: z.coerce
      .number()
      .int()
      .min(1, "Capacité minimale : 1 client"),
  })
  .refine((d) => d.end_at > d.start_at, {
    message: "L'heure de fin doit être après l'heure de début",
    path: ["end_at"],
  });

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
    capacity_per_slot: formData.get("capacity_per_slot"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  }

  const startsIso = localDateTimeToParisUTC(parsed.data.start_at);
  const endsIso = localDateTimeToParisUTC(parsed.data.end_at);

  const admin = createSupabaseAdminClient();
  const { error: insertError } = await admin.from("slots").insert({
    producer_id: producerRes.id,
    rule_id: null,
    starts_at: startsIso,
    ends_at: endsIso,
    capacity_per_slot: parsed.data.capacity_per_slot,
    active: true,
  });

  if (insertError) {
    if (insertError.code === "23505") {
      return {
        error:
          "Un créneau existe déjà à cet horaire pour votre exploitation.",
      };
    }
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

export async function excludeSlotAction(
  slotId: string,
): Promise<{ success: true } | { error: string }> {
  const session = await getSessionUser();
  if (!session) return { error: "Non authentifié" };

  const producerRes = await resolveProducerId(session.id);
  if ("error" in producerRes) return { error: producerRes.error };

  const admin = createSupabaseAdminClient();
  const { data: slot } = await admin
    .from("slots")
    .select("id, producer_id")
    .eq("id", slotId)
    .maybeSingle();
  if (!slot || slot.producer_id !== producerRes.id) {
    return { error: "Créneau introuvable." };
  }

  // Guard : pas d'exclusion si order active (pending/confirmed).
  // Les orders historiques (completed/cancelled/refunded) n'empêchent pas
  // l'exclusion : le slot est déjà consommé ou annulé côté commande.
  const { count: activeOrderCount } = await admin
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("slot_id", slotId)
    .in("statut", ACTIVE_ORDER_STATUTS as unknown as string[]);
  if ((activeOrderCount ?? 0) > 0) {
    return {
      error:
        "Une commande active est liée à ce créneau. Annulez-la avant d'exclure.",
    };
  }

  const { error: updateError } = await admin
    .from("slots")
    .update({ excluded_at: new Date().toISOString() })
    .eq("id", slotId);
  if (updateError) {
    console.error(
      `EXCLUDE_SLOT_ERROR slot_id=${slotId} error=${updateError.message}`,
    );
    return { error: "Impossible d'exclure le créneau." };
  }

  revalidatePath("/creneaux");
  return { success: true };
}

export async function unexcludeSlotAction(
  slotId: string,
): Promise<{ success: true } | { error: string }> {
  const session = await getSessionUser();
  if (!session) return { error: "Non authentifié" };

  const producerRes = await resolveProducerId(session.id);
  if ("error" in producerRes) return { error: producerRes.error };

  const admin = createSupabaseAdminClient();
  const { data: slot } = await admin
    .from("slots")
    .select("id, producer_id")
    .eq("id", slotId)
    .maybeSingle();
  if (!slot || slot.producer_id !== producerRes.id) {
    return { error: "Créneau introuvable." };
  }

  const { error: updateError } = await admin
    .from("slots")
    .update({ excluded_at: null })
    .eq("id", slotId);
  if (updateError) {
    console.error(
      `UNEXCLUDE_SLOT_ERROR slot_id=${slotId} error=${updateError.message}`,
    );
    return { error: "Impossible de rétablir le créneau." };
  }

  revalidatePath("/creneaux");
  return { success: true };
}

const bulkExcludeRangeSchema = z
  .object({
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD"),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD"),
  })
  .refine((d) => d.end_date >= d.start_date, {
    message: "La date de fin doit être après la date de début",
    path: ["end_date"],
  });

export type BulkExcludeRangeState = {
  error?: string;
  success?: boolean;
  count_excluded?: number;
  count_skipped_orders?: number;
};

export async function bulkExcludeRangeAction(
  _prev: BulkExcludeRangeState,
  formData: FormData,
): Promise<BulkExcludeRangeState> {
  const session = await getSessionUser();
  if (!session) return { error: "Non authentifié" };

  const producerRes = await resolveProducerId(session.id);
  if ("error" in producerRes) return { error: producerRes.error };

  const parsed = bulkExcludeRangeSchema.safeParse({
    start_date: formData.get("start_date"),
    end_date: formData.get("end_date"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  }

  // Bornes inclusives côté Europe/Paris : [start_date 00:00 Paris,
  // end_date+1 00:00 Paris) en UTC ISO.
  const startBoundary = dateStrToParisUTC(parsed.data.start_date);
  const endDateTZ = new TZDate(
    ...(parsed.data.end_date.split("-").map(Number) as [number, number, number]),
    0,
    0,
    0,
    TZ_PARIS,
  );
  const endBoundary = addDays(
    new TZDate(
      endDateTZ.getFullYear(),
      endDateTZ.getMonth(),
      endDateTZ.getDate(),
      0,
      0,
      0,
      TZ_PARIS,
    ),
    1,
  ).toISOString();

  const admin = createSupabaseAdminClient();

  // 1. Candidats : slots du producer dans la plage, pas encore exclus.
  const { data: candidates, error: fetchError } = await admin
    .from("slots")
    .select("id")
    .eq("producer_id", producerRes.id)
    .is("excluded_at", null)
    .gte("starts_at", startBoundary)
    .lt("starts_at", endBoundary);
  if (fetchError) {
    console.error(
      `BULK_EXCLUDE_FETCH_ERROR producer_id=${producerRes.id} error=${fetchError.message}`,
    );
    return { error: "Impossible de lire les créneaux." };
  }

  const candidateIds = (candidates ?? []).map((s) => s.id as string);
  if (candidateIds.length === 0) {
    return { success: true, count_excluded: 0, count_skipped_orders: 0 };
  }

  // 2. Slots bloqués par une order active → skip (non-bloquant, on exclut
  //    le reste et on retourne le compte).
  const { data: blockedOrders } = await admin
    .from("orders")
    .select("slot_id")
    .in("slot_id", candidateIds)
    .in("statut", ACTIVE_ORDER_STATUTS as unknown as string[]);
  const blockedSet = new Set(
    (blockedOrders ?? [])
      .map((o) => o.slot_id as string | null)
      .filter((id): id is string => id !== null),
  );
  const toExclude = candidateIds.filter((id) => !blockedSet.has(id));

  // 3. UPDATE bulk
  if (toExclude.length > 0) {
    const { error: updateError } = await admin
      .from("slots")
      .update({ excluded_at: new Date().toISOString() })
      .in("id", toExclude);
    if (updateError) {
      console.error(
        `BULK_EXCLUDE_UPDATE_ERROR producer_id=${producerRes.id} error=${updateError.message}`,
      );
      return { error: "Impossible d'appliquer l'exclusion." };
    }
  }

  revalidatePath("/creneaux");
  return {
    success: true,
    count_excluded: toExclude.length,
    count_skipped_orders: blockedSet.size,
  };
}
