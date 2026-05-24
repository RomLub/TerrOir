import { TZDate } from "@date-fns/tz";
import { formatSlotRange } from "@/lib/slots/format-slot-time";
import type { SlotMode } from "@/lib/slots/validators";

// Regroupement des créneaux d'une semaine en « ouvertures » affichables sur le
// calendrier producteur (ADR-0012). Helper pur (testable sans Supabase).
//
// Règles de regroupement, par jour (Europe/Paris) :
//   - créneaux issus d'une règle récurrente → 1 bloc par règle (les tranches
//     d'un même rdv sont collapsées), libellé = plage de la règle ce jour-là.
//   - créneaux ponctuels (rule_id null) → fusion des tranches CONTIGUËS de même
//     capacité en 1 bloc (un rdv ponctuel = N tranches collées → 1 bloc ;
//     deux ouvertures ponctuelles distinctes → 2 blocs).
//   - un bloc est « fermé » si TOUS ses créneaux sont exclus (excluded_at).

const TZ = "Europe/Paris";
const WEEKDAY_SHORT = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

export type CalendarSlot = {
  id: string;
  starts_at: string;
  ends_at: string;
  capacity_per_slot: number;
  rule_id: string | null;
  excluded_at: string | null;
};

export type CalendarRule = {
  id: string;
  mode: SlotMode;
  start_time: string;
  end_time: string;
  capacity_per_slot: number;
};

export type CalendarBlock = {
  key: string;
  kind: "recurring" | "oneoff";
  ruleId: string | null;
  label: string; // "9h–12h"
  mode: SlotMode;
  capacity: number;
  slotCount: number;
  slotIds: string[];
  excluded: boolean;
  hasActiveOrder: boolean;
  sortKey: number; // min starts_at ms
};

export type CalendarDay = {
  dateKey: string; // yyyy-MM-dd (Paris)
  weekdayLabel: string; // "Lun"
  dayNum: number; // 26
  isToday: boolean;
  blocks: CalendarBlock[];
};

export function parisDateKey(iso: string): string {
  const d = new TZDate(iso, TZ);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function groupWeekSlots(params: {
  dayKeys: string[]; // 7 clés Paris (lundi → dimanche)
  todayKey: string;
  slots: CalendarSlot[];
  rules: CalendarRule[];
  blockedSlotIds: Set<string>;
}): CalendarDay[] {
  const { dayKeys, todayKey, slots, rules, blockedSlotIds } = params;
  const ruleById = new Map(rules.map((r) => [r.id, r]));

  const byDay = new Map<string, CalendarSlot[]>();
  for (const s of slots) {
    const key = parisDateKey(s.starts_at);
    const arr = byDay.get(key);
    if (arr) arr.push(s);
    else byDay.set(key, [s]);
  }

  return dayKeys.map((dateKey, idx) => {
    const daySlots = (byDay.get(dateKey) ?? [])
      .slice()
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));

    const byRule = new Map<string, CalendarSlot[]>();
    const adhoc: CalendarSlot[] = [];
    for (const s of daySlots) {
      if (s.rule_id) {
        const arr = byRule.get(s.rule_id);
        if (arr) arr.push(s);
        else byRule.set(s.rule_id, [s]);
      } else {
        adhoc.push(s);
      }
    }

    const blocks: CalendarBlock[] = [];

    for (const [ruleId, group] of byRule) {
      const rule = ruleById.get(ruleId);
      const starts = group[0]!.starts_at;
      const ends = group[group.length - 1]!.ends_at;
      blocks.push({
        key: `r-${ruleId}-${dateKey}`,
        kind: "recurring",
        ruleId,
        label: formatSlotRange(starts, ends),
        mode: rule?.mode ?? (group.length > 1 ? "rdv" : "libre"),
        capacity: rule?.capacity_per_slot ?? group[0]!.capacity_per_slot,
        slotCount: group.length,
        slotIds: group.map((s) => s.id),
        excluded: group.every((s) => s.excluded_at !== null),
        hasActiveOrder: group.some((s) => blockedSlotIds.has(s.id)),
        sortKey: Date.parse(starts),
      });
    }

    // Ponctuels : fusion des tranches contiguës de même capacité.
    let i = 0;
    while (i < adhoc.length) {
      const group = [adhoc[i]!];
      let j = i + 1;
      while (
        j < adhoc.length &&
        adhoc[j]!.starts_at === group[group.length - 1]!.ends_at &&
        adhoc[j]!.capacity_per_slot === group[0]!.capacity_per_slot
      ) {
        group.push(adhoc[j]!);
        j++;
      }
      const starts = group[0]!.starts_at;
      const ends = group[group.length - 1]!.ends_at;
      blocks.push({
        key: `a-${group[0]!.id}`,
        kind: "oneoff",
        ruleId: null,
        label: formatSlotRange(starts, ends),
        mode: group.length > 1 ? "rdv" : "libre",
        capacity: group[0]!.capacity_per_slot,
        slotCount: group.length,
        slotIds: group.map((s) => s.id),
        excluded: group.every((s) => s.excluded_at !== null),
        hasActiveOrder: group.some((s) => blockedSlotIds.has(s.id)),
        sortKey: Date.parse(starts),
      });
      i = j;
    }

    blocks.sort((a, b) => a.sortKey - b.sortKey);

    const dd = dateKey.split("-")[2] ?? "0";
    return {
      dateKey,
      weekdayLabel: WEEKDAY_SHORT[idx] ?? "",
      dayNum: parseInt(dd, 10),
      isToday: dateKey === todayKey,
      blocks,
    };
  });
}
