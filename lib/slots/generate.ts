import { TZDate } from '@date-fns/tz';
import { addDays, startOfISOWeek, differenceInCalendarDays } from 'date-fns';
import type { SupabaseClient } from '@supabase/supabase-js';

// Phase 3 du chantier Créneaux personnalisables : matérialise des instances
// slots depuis les slot_rules actives d'un producteur. Idempotent (UPSERT
// onConflict producer_id,starts_at ignoreDuplicates) donc callable sans
// danger à chaque requête. Les slots passés ne sont jamais touchés, les
// orders historiques restent intactes.

const TZ = 'Europe/Paris';
const TTL_MS = 15 * 60 * 1000;

// Mémo in-memory par producer_id, TTL 15 min. Scope du runtime Vercel (pas
// partagé entre instances). Évite de regénérer à chaque hit de page produit
// consumer. Bustable côté producer via invalidation explicite (Phase 4).
const lastRun = new Map<string, number>();

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

export async function generateSlotsForProducer(
  supabase: SupabaseClient,
  producerId: string,
  horizonDays = 28,
): Promise<{ inserted: number }> {
  const nowMs = Date.now();
  const last = lastRun.get(producerId);
  if (last !== undefined && nowMs - last < TTL_MS) {
    return { inserted: 0 };
  }

  const { data: rules, error: rulesError } = await supabase
    .from('slot_rules')
    .select(
      'id, producer_id, days_of_week, periodicity_weeks, start_time, end_time, slot_duration_minutes, capacity_per_slot, created_at',
    )
    .eq('producer_id', producerId)
    .eq('active', true);

  if (rulesError) throw rulesError;
  if (!rules || rules.length === 0) {
    lastRun.set(producerId, nowMs);
    return { inserted: 0 };
  }

  const nowInParis = new TZDate(nowMs, TZ);
  const rows: SlotRow[] = [];

  for (const rule of rules as SlotRule[]) {
    const ruleCreated = new TZDate(rule.created_at, TZ);
    const ruleWeekStart = startOfISOWeek(ruleCreated);
    const [sh, sm] = parseHM(rule.start_time);
    const [eh, em] = parseHM(rule.end_time);

    for (let d = 0; d < horizonDays; d++) {
      const day = addDays(nowInParis, d);
      const dow = day.getDay();
      if (!rule.days_of_week.includes(dow)) continue;

      // Ancrage periodicity sur startOfISOWeek(rule.created_at) (Option A).
      // diffDays est un multiple de 7 car les deux bornes sont des lundis.
      const dayWeekStart = startOfISOWeek(day);
      const diffDays = differenceInCalendarDays(dayWeekStart, ruleWeekStart);
      if (diffDays < 0) continue;
      const weeksSince = Math.round(diffDays / 7);
      if (weeksSince % rule.periodicity_weeks !== 0) continue;

      // Jour calendaire en Europe/Paris, heure rule appliquée.
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
      let slotStartMs = dayStart.getTime();
      const dayEndMs = dayEnd.getTime();

      // Slots complets uniquement : last_start + duration ≤ end_time.
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
    }
  }

  if (rows.length === 0) {
    lastRun.set(producerId, nowMs);
    return { inserted: 0 };
  }

  const { error: upsertError } = await supabase
    .from('slots')
    .upsert(rows, {
      onConflict: 'producer_id,starts_at',
      ignoreDuplicates: true,
    });

  if (upsertError) throw upsertError;

  lastRun.set(producerId, nowMs);
  return { inserted: rows.length };
}
