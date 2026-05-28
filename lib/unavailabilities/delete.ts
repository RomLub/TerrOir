import { TZDate } from '@date-fns/tz';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  generateSlotsForProducerOnDate,
  invalidateProducer,
} from '@/lib/slots/generate';
import type {
  DeleteUnavailabilityInput,
  DeleteUnavailabilityResult,
} from './types';

const TZ = 'Europe/Paris';

function parisDayStartISO(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new TZDate(y!, (m ?? 1) - 1, d ?? 1, 0, 0, 0, TZ).toISOString();
}

function parisDayEndISO(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new TZDate(y!, (m ?? 1) - 1, d ?? 1, 23, 59, 59, TZ).toISOString();
}

// Supprime une indisponibilité et restaure le jour : UN-exclude les slots
// existants + régénération ciblée de ce jour uniquement (selon les rules
// récurrentes actives au moment du delete, y compris celles créées APRÈS
// la pose de l'indispo).
//
// Ordre des étapes (sécurisé) :
//   1) Lookup + ownership : capture la date avant le DELETE.
//   2) DELETE de l'indispo. Si la garde générative consultait les
//      unavailabilities AVANT cette étape, elle skipperait encore le jour.
//   3) UN-exclude des slots existants du jour (excluded_at = NULL). Pas
//      d'effet de bord sur les commandes (enlever une exclusion ne casse
//      rien).
//   4) Régénération ciblée : generateSlotsForProducerOnDate. UPSERT
//      idempotent (onConflict ignoreDuplicates) → slots avec commandes
//      actives strictement intacts.
export async function deleteUnavailability(
  input: DeleteUnavailabilityInput,
): Promise<DeleteUnavailabilityResult> {
  if (!input.unavailabilityId) {
    return { error: 'unavailabilityId manquant.', code: 'INVALID_INPUT' };
  }

  const admin = createSupabaseAdminClient();

  // 1. Lookup avec ownership check (producer_id).
  const { data: existing, error: lookupErr } = await admin
    .from('unavailabilities')
    .select('id, producer_id, date')
    .eq('id', input.unavailabilityId)
    .maybeSingle();
  if (lookupErr) {
    console.error(
      `DELETE_UNAVAILABILITY_LOOKUP_ERROR id=${input.unavailabilityId} error=${lookupErr.message}`,
    );
    return {
      error: 'Indisponibilité introuvable.',
      code: 'NOT_FOUND',
    };
  }
  if (!existing || existing.producer_id !== input.producerId) {
    return { error: 'Indisponibilité introuvable.', code: 'NOT_FOUND' };
  }
  const date = existing.date as string;

  // 2. DELETE.
  const { error: deleteErr } = await admin
    .from('unavailabilities')
    .delete()
    .eq('id', input.unavailabilityId);
  if (deleteErr) {
    console.error(
      `DELETE_UNAVAILABILITY_ERROR id=${input.unavailabilityId} error=${deleteErr.message}`,
    );
    return {
      error: "Impossible de supprimer l'indisponibilité.",
      code: 'INTERNAL',
    };
  }

  // 3. UN-exclude des slots existants du jour.
  const startBoundary = parisDayStartISO(date);
  const endBoundary = parisDayEndISO(date);
  const { error: unexcludeErr } = await admin
    .from('slots')
    .update({ excluded_at: null })
    .eq('producer_id', input.producerId)
    .not('excluded_at', 'is', null)
    .gte('starts_at', startBoundary)
    .lte('starts_at', endBoundary);
  if (unexcludeErr) {
    console.warn(
      `DELETE_UNAVAILABILITY_UNEXCLUDE_WARN producer_id=${input.producerId} date=${date} error=${unexcludeErr.message}`,
    );
  }

  // 4. Régénération ciblée du jour (bypass TTL, intention explicite).
  // Garantie idempotence UPSERT : slots avec commandes actives intacts.
  invalidateProducer(input.producerId);
  let inserted = 0;
  try {
    const res = await generateSlotsForProducerOnDate(
      admin,
      input.producerId,
      date,
    );
    inserted = res.inserted;
  } catch (err) {
    console.warn(
      `DELETE_UNAVAILABILITY_REGEN_WARN producer_id=${input.producerId} date=${date} error=${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return { success: true, regenerated_slots: inserted };
}
