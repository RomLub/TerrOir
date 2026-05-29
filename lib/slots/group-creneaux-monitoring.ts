import { TZDate } from "@date-fns/tz";
import { formatSlotRange } from "@/lib/slots/format-slot-time";
import type { SlotMode } from "@/lib/slots/validators";

// Regroupement des créneaux d'une semaine en blocs de monitoring du
// remplissage des places (ADR-0014). Helper pur (testable sans Supabase).
//
// Différences avec groupWeekSlots :
//   - filtre les sous-slots exclus AVANT tout grouping (un sous-slot fermé
//     n'est pas réservable, donc ses places n'apparaissent pas) ;
//   - un jour sans aucun sous-slot actif disparaît du retour (la maquette
//     impose : pas d'en-tête, pas de date pour les jours vides) ;
//   - chaque bloc expose ses cases (1 case = 1 place réservable), avec
//     mapping vers la commande pour les places réservées.
//
// Ordre des cases dans un bloc :
//   pour chaque sous-slot dans l'ordre chronologique, on émet d'abord les
//   cases réservées (ordre createdAt asc, tie-break orderId asc), puis les
//   cases libres restant à concurrence de la capacité du sous-slot.
//
// Mode :
//   - libre : 1 sous-slot par bloc, N cases = capacité.
//   - rdv   : N sous-slots par bloc, total = N × capacité cases.

const TZ = "Europe/Paris";
const WEEKDAY_LONG = [
  "Lundi",
  "Mardi",
  "Mercredi",
  "Jeudi",
  "Vendredi",
  "Samedi",
  "Dimanche",
];

export type MonitoringSlot = {
  id: string;
  starts_at: string;
  ends_at: string;
  capacity_per_slot: number;
  rule_id: string | null;
  excluded_at: string | null;
  availability_scope?: "shared" | "product_restricted" | null;
};

export type MonitoringRule = {
  id: string;
  mode: SlotMode;
  capacity_per_slot: number;
  slot_duration_minutes: number;
};

export type MonitoringOrder = {
  id: string;
  numero: string;
  consumerFirstName: string | null;
  createdAt: string;
};

export type MonitoringCell =
  | {
      kind: "reserved";
      orderId: string;
      orderNumber: string;
      consumerFirstName: string | null;
      subSlotStartIso: string;
    }
  | {
      kind: "free";
      subSlotStartIso: string;
    };

export type MonitoringBlock = {
  key: string;
  kind: "recurring" | "oneoff";
  availabilityScope: "shared" | "product_restricted";
  ruleId: string | null;
  label: string;
  mode: SlotMode;
  durationLabel: string;
  cells: MonitoringCell[];
  totalCapacity: number;
  reservedCount: number;
  sortKey: number;
};

export type MonitoringDay = {
  dateKey: string;
  weekdayLabel: string;
  dayNum: number;
  isToday: boolean;
  blocks: MonitoringBlock[];
  blockCount: number;
  totalCapacity: number;
  reservedCount: number;
};

function parisDateKey(iso: string): string {
  const d = new TZDate(iso, TZ);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function groupCreneauxMonitoring(params: {
  dayKeys: string[];
  todayKey: string;
  slots: MonitoringSlot[];
  rules: MonitoringRule[];
  ordersBySlot: Map<string, MonitoringOrder[]>;
}): MonitoringDay[] {
  const { dayKeys, todayKey, slots, rules, ordersBySlot } = params;
  const ruleById = new Map(rules.map((r) => [r.id, r]));

  // Filtre exclusions AVANT grouping : les sous-slots fermés n'ont pas de
  // places réservables, donc leur capacité n'apparaît pas en monitoring.
  // Conséquence : un bloc partiellement exclu n'affiche que les sous-slots
  // ouverts ; un bloc entièrement exclu disparaît.
  const activeSlots = slots.filter((s) => s.excluded_at === null);

  const byDay = new Map<string, MonitoringSlot[]>();
  for (const s of activeSlots) {
    const key = parisDateKey(s.starts_at);
    const arr = byDay.get(key);
    if (arr) arr.push(s);
    else byDay.set(key, [s]);
  }

  const result: MonitoringDay[] = [];

  for (let idx = 0; idx < dayKeys.length; idx++) {
    const dateKey = dayKeys[idx]!;
    const daySlots = (byDay.get(dateKey) ?? [])
      .slice()
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));

    if (daySlots.length === 0) continue;

    const byRule = new Map<string, MonitoringSlot[]>();
    const adhoc: MonitoringSlot[] = [];
    for (const s of daySlots) {
      if (s.rule_id) {
        const arr = byRule.get(s.rule_id);
        if (arr) arr.push(s);
        else byRule.set(s.rule_id, [s]);
      } else {
        adhoc.push(s);
      }
    }

    const blocks: MonitoringBlock[] = [];

    for (const [ruleId, group] of byRule) {
      const rule = ruleById.get(ruleId);
      const starts = group[0]!.starts_at;
      const ends = group[group.length - 1]!.ends_at;
      const mode: SlotMode =
        rule?.mode ?? (group.length > 1 ? "rdv" : "libre");
      const capacity = rule?.capacity_per_slot ?? group[0]!.capacity_per_slot;
      blocks.push(
        makeBlock({
          key: `r-${ruleId}-${dateKey}`,
          kind: "recurring",
          availabilityScope: group.some(
            (s) => s.availability_scope === "product_restricted",
          )
            ? "product_restricted"
            : "shared",
          ruleId,
          label: formatSlotRange(starts, ends),
          mode,
          capacity,
          slots: group,
          ordersBySlot,
          sortKey: Date.parse(starts),
          ruleDurationMinutes: rule?.slot_duration_minutes ?? null,
        }),
      );
    }

    // Ponctuels : fusion des sous-slots contigus de même capacité (les
    // sous-slots exclus déjà filtrés "trouent" naturellement les blocs).
    let i = 0;
    while (i < adhoc.length) {
      const group = [adhoc[i]!];
      let j = i + 1;
      const groupScope =
        adhoc[i]!.availability_scope === "product_restricted"
          ? "product_restricted"
          : "shared";
      while (
        j < adhoc.length &&
        adhoc[j]!.starts_at === group[group.length - 1]!.ends_at &&
        adhoc[j]!.capacity_per_slot === group[0]!.capacity_per_slot &&
        (adhoc[j]!.availability_scope === "product_restricted"
          ? "product_restricted"
          : "shared") === groupScope
      ) {
        group.push(adhoc[j]!);
        j++;
      }
      const starts = group[0]!.starts_at;
      const ends = group[group.length - 1]!.ends_at;
      const mode: SlotMode = group.length > 1 ? "rdv" : "libre";
      const capacity = group[0]!.capacity_per_slot;
      blocks.push(
        makeBlock({
          key: `a-${group[0]!.id}`,
          kind: "oneoff",
          availabilityScope: groupScope,
          ruleId: null,
          label: formatSlotRange(starts, ends),
          mode,
          capacity,
          slots: group,
          ordersBySlot,
          sortKey: Date.parse(starts),
          ruleDurationMinutes: null,
        }),
      );
      i = j;
    }

    if (blocks.length === 0) continue;

    blocks.sort((a, b) => a.sortKey - b.sortKey);

    const totalCapacity = blocks.reduce((acc, b) => acc + b.totalCapacity, 0);
    const reservedCount = blocks.reduce((acc, b) => acc + b.reservedCount, 0);

    const dd = dateKey.split("-")[2] ?? "0";
    result.push({
      dateKey,
      weekdayLabel: WEEKDAY_LONG[idx] ?? "",
      dayNum: parseInt(dd, 10),
      isToday: dateKey === todayKey,
      blocks,
      blockCount: blocks.length,
      totalCapacity,
      reservedCount,
    });
  }

  return result;
}

function makeBlock(params: {
  key: string;
  kind: "recurring" | "oneoff";
  availabilityScope: "shared" | "product_restricted";
  ruleId: string | null;
  label: string;
  mode: SlotMode;
  capacity: number;
  slots: MonitoringSlot[];
  ordersBySlot: Map<string, MonitoringOrder[]>;
  sortKey: number;
  ruleDurationMinutes: number | null;
}): MonitoringBlock {
  const cells: MonitoringCell[] = [];
  let reservedCount = 0;

  for (const slot of params.slots) {
    const orders = (params.ordersBySlot.get(slot.id) ?? [])
      .slice()
      .sort((a, b) => {
        const da = Date.parse(a.createdAt);
        const db = Date.parse(b.createdAt);
        if (da !== db) return da - db;
        return a.id.localeCompare(b.id);
      });

    if (orders.length > params.capacity) {
      // Anomalie : la garantie SELECT ... FOR UPDATE du checkout devrait
      // empêcher cette situation. On tronque visuellement pour ne pas
      // déborder du bloc, on signale en console.
      console.warn(
        `[monitoring] slot ${slot.id} : ${orders.length} commandes actives pour capacité ${params.capacity}`,
      );
    }

    const reservedHere = Math.min(orders.length, params.capacity);
    for (let k = 0; k < reservedHere; k++) {
      const o = orders[k]!;
      cells.push({
        kind: "reserved",
        orderId: o.id,
        orderNumber: o.numero,
        consumerFirstName: o.consumerFirstName,
        subSlotStartIso: slot.starts_at,
      });
      reservedCount++;
    }
    const freeHere = params.capacity - reservedHere;
    for (let k = 0; k < freeHere; k++) {
      cells.push({ kind: "free", subSlotStartIso: slot.starts_at });
    }
  }

  return {
    key: params.key,
    kind: params.kind,
    availabilityScope: params.availabilityScope,
    ruleId: params.ruleId,
    label: params.label,
    mode: params.mode,
    durationLabel: computeDurationLabel(
      params.mode,
      params.ruleDurationMinutes,
      params.slots,
    ),
    cells,
    totalCapacity: params.slots.length * params.capacity,
    reservedCount,
    sortKey: params.sortKey,
  };
}

function computeDurationLabel(
  mode: SlotMode,
  ruleDurationMinutes: number | null,
  slots: MonitoringSlot[],
): string {
  if (mode === "libre") return "plage";
  if (ruleDurationMinutes && ruleDurationMinutes > 0) {
    return `RDV ${ruleDurationMinutes} min`;
  }
  const first = slots[0];
  if (!first) return "RDV";
  const ms = Date.parse(first.ends_at) - Date.parse(first.starts_at);
  const minutes = Math.round(ms / 60000);
  return `RDV ${minutes} min`;
}
