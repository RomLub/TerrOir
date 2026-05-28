import { TZDate } from "@date-fns/tz";

// Regroupement des slots du dashboard producteur en "plages paramétrées"
// affichables sur le calendrier vertical. Helper pur (testable sans
// Supabase). Distinct de `groupWeekSlots` (écran créneaux) : shape
// orientée tooltip dashboard (totalOrders + orders[]), pas de notion
// d'exclusion ni de mode RDV/libre (la RPC filtre déjà excluded_at).
//
// Règles de regroupement, par jour (Europe/Paris) :
//   - slots issus d'une rule (rule_id !== null) → 1 bande par
//     (rule_id, date locale Paris). startsAt = min, endsAt = max.
//   - slots ponctuels (rule_id === null) → fusion des tranches
//     CONTIGUËS (prev.ends_at === curr.starts_at) en 1 bande. Un RDV
//     ponctuel 14h-16h en tranches 15min = 8 slots collés → 1 bande.
//     Deux ouvertures ponctuelles séparées le même jour = 2 bandes.
//
// Invariant délibéré : len(band.orders) === band.totalOrders. La RPC
// garantit déjà l'invariant par slot (même filtre statut sur
// orders_count et orders). On le préserve par construction côté agrégat.

const TZ = "Europe/Paris";

export type DashboardSlotPayload = {
  id: string;
  starts_at: string;
  ends_at: string;
  capacity_per_slot: number;
  rule_id: string | null;
  orders_count: number;
  orders: DashboardOrderEntry[];
};

export type DashboardOrderEntry = {
  order_id: string;
  numero_commande: string;
  starts_at: string;
};

export type Band = {
  key: string;
  source: "rule" | "adhoc";
  ruleId: string | null;
  startsAt: string;
  endsAt: string;
  totalOrders: number;
  orders: DashboardOrderEntry[];
};

function parisDateKey(iso: string): string {
  const d = new TZDate(iso, TZ);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function groupIntoBands(slots: DashboardSlotPayload[]): Band[] {
  if (slots.length === 0) return [];

  const sorted = slots
    .slice()
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));

  const ruleGroups = new Map<string, DashboardSlotPayload[]>();
  const adhocSlots: DashboardSlotPayload[] = [];

  for (const s of sorted) {
    if (s.rule_id) {
      const key = `${s.rule_id}|${parisDateKey(s.starts_at)}`;
      const arr = ruleGroups.get(key);
      if (arr) arr.push(s);
      else ruleGroups.set(key, [s]);
    } else {
      adhocSlots.push(s);
    }
  }

  const bands: Band[] = [];

  for (const [key, group] of ruleGroups) {
    const ruleId = group[0]!.rule_id!;
    bands.push(buildBand({ key: `r-${key}`, source: "rule", ruleId, group }));
  }

  // Ad-hoc : fusion des tranches contiguës par jour. La contiguïté est
  // jugée sur l'égalité ms-à-ms (Date.parse) pour éviter les pièges de
  // formatage ISO. Un changement de jour (ends_at ≠ starts_at suivant)
  // casse naturellement le groupe.
  let i = 0;
  while (i < adhocSlots.length) {
    const group: DashboardSlotPayload[] = [adhocSlots[i]!];
    let j = i + 1;
    while (
      j < adhocSlots.length &&
      Date.parse(adhocSlots[j]!.starts_at) ===
        Date.parse(group[group.length - 1]!.ends_at)
    ) {
      group.push(adhocSlots[j]!);
      j++;
    }
    bands.push(
      buildBand({
        key: `a-${group[0]!.id}`,
        source: "adhoc",
        ruleId: null,
        group,
      }),
    );
    i = j;
  }

  bands.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  return bands;
}

function buildBand(params: {
  key: string;
  source: "rule" | "adhoc";
  ruleId: string | null;
  group: DashboardSlotPayload[];
}): Band {
  const { key, source, ruleId, group } = params;
  let startsAtMs = Infinity;
  let endsAtMs = -Infinity;
  let startsAt = group[0]!.starts_at;
  let endsAt = group[0]!.ends_at;
  let totalOrders = 0;
  const orders: DashboardOrderEntry[] = [];

  for (const slot of group) {
    const sMs = Date.parse(slot.starts_at);
    const eMs = Date.parse(slot.ends_at);
    if (sMs < startsAtMs) {
      startsAtMs = sMs;
      startsAt = slot.starts_at;
    }
    if (eMs > endsAtMs) {
      endsAtMs = eMs;
      endsAt = slot.ends_at;
    }
    totalOrders += slot.orders_count;
    for (const o of slot.orders) orders.push(o);
  }

  orders.sort((a, b) => a.numero_commande.localeCompare(b.numero_commande));

  return { key, source, ruleId, startsAt, endsAt, totalOrders, orders };
}
