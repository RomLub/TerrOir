"use server";

// =============================================================================
// Server actions — gestion des slot_rules producer (Phase 4 créneaux)
// =============================================================================
// 4 actions :
//   - createSlotRuleAction(prev, formData)       : via useFormState
//   - updateSlotRuleAction(ruleId, prev, formData) : via useFormState + bind
//   - toggleSlotRuleActiveAction(ruleId)         : direct call
//   - deleteSlotRuleAction(ruleId)               : direct call + guard orders
//
// Ownership check systématique : match producers.user_id = session.id via
// service_role (slot_rules n'a pas de relation user directe, on passe par
// producers). RLS "owner all" sur slot_rules sert aussi de défense en
// profondeur côté DB.
//
// Après chaque mutation : invalidateProducer(producerId) +
// generateSlotsForProducer(28) pour que l'UI consumer reflète immédiatement
// les changements (nouveaux slots matérialisés). DELETE = hard delete (CASCADE
// slots) mais bloqué si des orders historiques pointent dessus (FK sans
// CASCADE → échec sinon).
// =============================================================================

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  generateSlotsForProducer,
  invalidateProducer,
} from "@/lib/slots/generate";
import { slotRuleSchema } from "@/lib/slots/validators";

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
    await generateSlotsForProducer(admin, producerRes.id, 28);
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
    await generateSlotsForProducer(admin, producerRes.id, 28);
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
    .update({ actif: nextActive })
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
      await generateSlotsForProducer(admin, producerRes.id, 28);
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
