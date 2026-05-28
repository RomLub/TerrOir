import { TZDate } from '@date-fns/tz';
import { addDays, startOfISOWeek, differenceInCalendarDays } from 'date-fns';
import type { SupabaseClient } from '@supabase/supabase-js';

// Phase 3 du chantier Créneaux personnalisables : matérialise des instances
// slots depuis les slot_rules actives d'un producteur. Idempotent (UPSERT
// onConflict producer_id,starts_at ignoreDuplicates) donc callable sans
// danger à chaque requête. Les slots passés ne sont jamais touchés, les
// orders historiques restent intactes.
//
// Chantier indisponibilités (2026-05-28) : garde défense en profondeur — la
// matérialisation skip les jours marqués dans `unavailabilities` pour le
// producteur (cf. lib/unavailabilities/*). La RPC `create_order_with_items`
// pose la 2e garde côté réservation. Voir docs/decisions/0009.

const TZ = 'Europe/Paris';
const TTL_MS = 15 * 60 * 1000;

// Mémo in-memory par producer_id, TTL 15 min. Scope du runtime Vercel (pas
// partagé entre instances). Évite de regénérer à chaque hit de page produit
// consumer. Bustable côté producer via invalidation explicite (Phase 4).
const lastRun = new Map<string, number>();

// Force le prochain generateSlotsForProducer(producerId) à ré-exécuter
// (bypass du TTL 15 min). À appeler depuis les server actions de /creneaux
// après CRUD sur slot_rules, pour que le producer voie immédiatement l'effet
// de ses modifications sur les slots matérialisés.
export function invalidateProducer(producerId: string): void {
  lastRun.delete(producerId);
}

type SlotRule = {
  id: string;
  producer_id: string;
  days_of_week: number[];
  periodicity_weeks: number;
  start_time: string;
  end_time: string;
  slot_duration_minutes: number;
  capacity_per_slot: number;
  created_at: string;
};

type SlotRow = {
  rule_id: string;
  producer_id: string;
  starts_at: string;
  ends_at: string;
  capacity_per_slot: number;
};

function parseHM(t: string): [number, number] {
  const [h, m] = t.split(':').map(Number);
  return [h ?? 0, m ?? 0];
}

// Format YYYY-MM-DD d'un jour calendaire Europe/Paris. Utilisé pour matcher
// les `unavailabilities.date` (qui est un `date` Postgres, sans TZ).
function parisDayKey(day: TZDate): string {
  const y = day.getFullYear();
  const m = String(day.getMonth() + 1).padStart(2, '0');
  const d = String(day.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Fetch les jours indisponibles d'un producteur dans une plage
// [fromDayKey, toDayKey] (inclusif). Tolérant : en cas d'erreur, on log un
// warning et on retourne un Set vide (ne bloque pas la génération). La RPC
// `create_order_with_items` pose la 2e garde au moment de la réservation.
async function fetchUnavailableDates(
  supabase: SupabaseClient,
  producerId: string,
  fromDayKey: string,
  toDayKey: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('unavailabilities')
    .select('date')
    .eq('producer_id', producerId)
    .gte('date', fromDayKey)
    .lte('date', toDayKey);
  if (error) {
    console.warn(
      `GENERATE_SLOTS unavailabilities fetch failed producer_id=${producerId} error=${error.message}`,
    );
    return new Set();
  }
  return new Set((data ?? []).map((u) => u.date as string));
}

// Calcule les slots à matérialiser pour UN jour calendaire donné selon UNE
// rule. Helper privé partagé entre generateSlotsForProducer (boucle horizon)
// et generateSlotsForProducerOnDate (régénération ciblée delete d'indispo).
// Renvoie le tableau de rows à upserter (peut être vide : rule non applicable
// ce jour, jour avant la rule, slots passés).
function buildSlotsForRuleOnDay(
  rule: SlotRule,
  day: TZDate,
  producerId: string,
  nowMs: number,
): SlotRow[] {
  const dow = day.getDay();
  if (!rule.days_of_week.includes(dow)) return [];

  // Ancrage periodicity sur startOfISOWeek(rule.created_at) (Option A).
  // diffDays est un multiple de 7 car les deux bornes sont des lundis.
  const ruleCreated = new TZDate(rule.created_at, TZ);
  const ruleWeekStart = startOfISOWeek(ruleCreated);
  const dayWeekStart = startOfISOWeek(day);
  const diffDays = differenceInCalendarDays(dayWeekStart, ruleWeekStart);
  if (diffDays < 0) return [];
  const weeksSince = Math.round(diffDays / 7);
  if (weeksSince % rule.periodicity_weeks !== 0) return [];

  const [sh, sm] = parseHM(rule.start_time);
  const [eh, em] = parseHM(rule.end_time);

  const dayStart = new TZDate(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    sh,
    sm,
    0,
    TZ,
  );
  const dayEnd = new TZDate(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    eh,
    em,
    0,
    TZ,
  );

  const durationMs = rule.slot_duration_minutes * 60_000;
  const dayEndMs = dayEnd.getTime();
  const rows: SlotRow[] = [];

  let slotStartMs = dayStart.getTime();
  while (slotStartMs + durationMs <= dayEndMs) {
    // Filtre slots passés : inutile de matérialiser avant now().
    if (slotStartMs > nowMs) {
      rows.push({
        rule_id: rule.id,
        producer_id: producerId,
        starts_at: new Date(slotStartMs).toISOString(),
        ends_at: new Date(slotStartMs + durationMs).toISOString(),
        capacity_per_slot: rule.capacity_per_slot,
      });
    }
    slotStartMs += durationMs;
  }
  return rows;
}

// Charge les rules actives + (optionnellement) les jours indisponibles d'un
// producer. Helper privé partagé entre les 2 entrées publiques.
async function loadRulesAndUnavailable(
  supabase: SupabaseClient,
  producerId: string,
  fromDayKey: string,
  toDayKey: string,
): Promise<{ rules: SlotRule[]; unavailableDates: Set<string> }> {
  const { data: rules, error: rulesError } = await supabase
    .from('slot_rules')
    .select(
      'id, producer_id, days_of_week, periodicity_weeks, start_time, end_time, slot_duration_minutes, capacity_per_slot, created_at',
    )
    .eq('producer_id', producerId)
    .eq('active', true);
  if (rulesError) throw rulesError;

  const unavailableDates = await fetchUnavailableDates(
    supabase,
    producerId,
    fromDayKey,
    toDayKey,
  );
  return { rules: (rules ?? []) as SlotRule[], unavailableDates };
}

// UPSERT idempotent vers public.slots. onConflict producer_id,starts_at
// ignoreDuplicates → un slot existant à cette starts_at n'est PAS touché.
// Garantit que les commandes actives sur slots existants ne sont jamais
// perturbées par une régénération.
async function upsertSlots(
  supabase: SupabaseClient,
  rows: SlotRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase
    .from('slots')
    .upsert(rows, {
      onConflict: 'producer_id,starts_at',
      ignoreDuplicates: true,
    });
  if (error) throw error;
}

export async function generateSlotsForProducer(
  supabase: SupabaseClient,
  producerId: string,
  horizonDays = 90,
): Promise<{ inserted: number }> {
  const nowMs = Date.now();
  const last = lastRun.get(producerId);
  if (last !== undefined && nowMs - last < TTL_MS) {
    return { inserted: 0 };
  }

  const nowInParis = new TZDate(nowMs, TZ);
  const horizonEnd = addDays(nowInParis, Math.max(0, horizonDays - 1));
  const { rules, unavailableDates } = await loadRulesAndUnavailable(
    supabase,
    producerId,
    parisDayKey(nowInParis),
    parisDayKey(horizonEnd),
  );

  if (rules.length === 0) {
    lastRun.set(producerId, nowMs);
    return { inserted: 0 };
  }

  const rows: SlotRow[] = [];

  for (const rule of rules) {
    for (let d = 0; d < horizonDays; d++) {
      const day = addDays(nowInParis, d);
      // Garde unavailabilities : un jour marqué indisponible ne génère aucun
      // slot, même si une rule récurrente créée après l'indispo le couvre.
      if (unavailableDates.has(parisDayKey(day))) continue;
      rows.push(...buildSlotsForRuleOnDay(rule, day, producerId, nowMs));
    }
  }

  if (rows.length === 0) {
    lastRun.set(producerId, nowMs);
    return { inserted: 0 };
  }

  await upsertSlots(supabase, rows);

  lastRun.set(producerId, nowMs);
  return { inserted: rows.length };
}

// Régénère les slots d'UN jour précis (date Europe/Paris, YYYY-MM-DD).
// Bypass volontaire du TTL : intention explicite du caller (typiquement
// deleteUnavailability après DELETE de l'indispo + UN-exclude des slots
// existants). Re-fetch les unavailabilities pour respecter la garde — si
// après le DELETE une autre indispo couvre encore ce jour (cas théorique :
// course concurrente), on n'écrit rien.
//
// L'UPSERT idempotent garantit que les slots existants avec commandes
// actives ne sont jamais touchés (onConflict ignoreDuplicates).
export async function generateSlotsForProducerOnDate(
  supabase: SupabaseClient,
  producerId: string,
  date: string,
): Promise<{ inserted: number }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`generateSlotsForProducerOnDate: date invalide "${date}"`);
  }
  const nowMs = Date.now();

  const { rules, unavailableDates } = await loadRulesAndUnavailable(
    supabase,
    producerId,
    date,
    date,
  );
  if (rules.length === 0) return { inserted: 0 };
  if (unavailableDates.has(date)) return { inserted: 0 };

  // Construit le TZDate du jour à 00:00 Europe/Paris.
  const [y, m, d] = date.split('-').map(Number);
  const day = new TZDate(y!, (m ?? 1) - 1, d ?? 1, 0, 0, 0, TZ);

  const rows: SlotRow[] = [];
  for (const rule of rules) {
    rows.push(...buildSlotsForRuleOnDay(rule, day, producerId, nowMs));
  }

  if (rows.length === 0) return { inserted: 0 };

  await upsertSlots(supabase, rows);
  return { inserted: rows.length };
}
