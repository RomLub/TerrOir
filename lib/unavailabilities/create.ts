import { TZDate } from '@date-fns/tz';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { invalidateProducer } from '@/lib/slots/generate';
import { detectBlockingOrdersForDates } from './detect-blocking-orders';
import type {
  CreateUnavailabilitiesInput,
  CreateUnavailabilitiesResult,
} from './types';

const TZ = 'Europe/Paris';
const MAX_DATES_PER_CALL = 90;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// YYYY-MM-DD Europe/Paris pour aujourd'hui.
function todayParisKey(): string {
  const now = new TZDate(Date.now(), TZ);
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parisDayStartISO(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new TZDate(y!, (m ?? 1) - 1, d ?? 1, 0, 0, 0, TZ).toISOString();
}

function parisDayEndISO(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  // 23:59:59.999 Europe/Paris → couvre tout slot du jour.
  return new TZDate(y!, (m ?? 1) - 1, d ?? 1, 23, 59, 59, TZ).toISOString();
}

// Pose une ou plusieurs indisponibilités (option B). Si l'une des dates a
// des commandes actives, refus avec liste détaillée (BLOCKING_ORDERS) pour
// que l'UI déclenche le pattern "Annuler et fermer" (PR #198), puis retente.
//
// Effet de bord après INSERT : pose `excluded_at = now()` sur les slots
// existants de ces jours pour cohérence display immédiate (le calendrier
// producteur les affiche fermés sans attendre la régénération). Ces slots
// resteront en sécurité grâce à la garde RPC. La PR #2 (UI) retirera
// l'unique caller direct d'excluded_at (`bulkExcludeRangeAction`).
export async function createUnavailabilities(
  input: CreateUnavailabilitiesInput,
): Promise<CreateUnavailabilitiesResult> {
  // 1. Validation
  if (!Array.isArray(input.dates) || input.dates.length === 0) {
    return { error: 'Aucune date fournie.', code: 'INVALID_INPUT' };
  }
  if (input.dates.length > MAX_DATES_PER_CALL) {
    return {
      error: `Maximum ${MAX_DATES_PER_CALL} dates par appel.`,
      code: 'INVALID_INPUT',
    };
  }
  for (const d of input.dates) {
    if (!DATE_RE.test(d)) {
      return {
        error: `Date invalide : ${d} (format attendu YYYY-MM-DD).`,
        code: 'INVALID_INPUT',
      };
    }
  }
  const today = todayParisKey();
  const past = input.dates.filter((d) => d < today);
  if (past.length > 0) {
    return {
      error: `Date(s) déjà passée(s) : ${past.join(', ')}.`,
      code: 'INVALID_INPUT',
    };
  }
  const raison =
    typeof input.raison === 'string' ? input.raison.trim() || null : null;
  if (raison !== null && raison.length > 280) {
    return {
      error: 'La raison ne peut pas dépasser 280 caractères.',
      code: 'INVALID_INPUT',
    };
  }

  const uniqueDates = Array.from(new Set(input.dates)).sort();
  const admin = createSupabaseAdminClient();

  // 2. Détection commandes actives bloquantes.
  const blocking = await detectBlockingOrdersForDates(
    admin,
    input.producerId,
    uniqueDates,
  );
  if (blocking.length > 0) {
    return {
      error:
        "Des commandes actives existent sur certains jours. Annulez-les d'abord.",
      code: 'BLOCKING_ORDERS',
      blocking_orders: blocking,
    };
  }

  // 3. UPSERT idempotent (onConflict producer_id,date, ignoreDuplicates).
  const rows = uniqueDates.map((date) => ({
    producer_id: input.producerId,
    date,
    raison,
    created_by: input.createdBy,
  }));
  const { error: insertErr } = await admin
    .from('unavailabilities')
    .upsert(rows, {
      onConflict: 'producer_id,date',
      ignoreDuplicates: true,
    });
  if (insertErr) {
    console.error(
      `CREATE_UNAVAILABILITIES_INSERT_ERROR producer_id=${input.producerId} error=${insertErr.message}`,
    );
    return {
      error: "Impossible d'enregistrer l'indisponibilité.",
      code: 'INTERNAL',
    };
  }

  // 4. Cohérence display : marquer les slots existants des jours indispos
  // avec excluded_at = now(). Filtré : on ne touche QUE ceux non encore
  // exclus (réduit l'empreinte UPDATE). La RPC create_order_with_items
  // pose la 2e garde côté réservation, donc même si on ratait cette étape
  // les slots resteraient non-réservables.
  for (const date of uniqueDates) {
    const startBoundary = parisDayStartISO(date);
    const endBoundary = parisDayEndISO(date);
    const { error: updateErr } = await admin
      .from('slots')
      .update({ excluded_at: new Date().toISOString() })
      .eq('producer_id', input.producerId)
      .is('excluded_at', null)
      .gte('starts_at', startBoundary)
      .lte('starts_at', endBoundary);
    if (updateErr) {
      console.warn(
        `CREATE_UNAVAILABILITIES_SLOT_EXCLUDE_WARN producer_id=${input.producerId} date=${date} error=${updateErr.message}`,
      );
    }
  }

  invalidateProducer(input.producerId);
  return { success: true, created_count: uniqueDates.length };
}
