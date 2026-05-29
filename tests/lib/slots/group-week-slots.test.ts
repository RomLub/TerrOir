import { describe, it, expect } from "vitest";
import {
  groupWeekSlots,
  parisDateKey,
  type CalendarSlot,
  type CalendarRule,
} from "@/lib/slots/group-week-slots";

// Tous les ISO sont en UTC ; juin = CEST (UTC+2) → 07:00Z = 09:00 Paris.
const DAY = "2026-06-03";
const DAY_KEYS = [
  "2026-06-01",
  "2026-06-02",
  "2026-06-03",
  "2026-06-04",
  "2026-06-05",
  "2026-06-06",
  "2026-06-07",
];

const rules: CalendarRule[] = [
  { id: "R1", mode: "rdv", start_time: "09:00", end_time: "12:00", capacity_per_slot: 2 },
];

function recurringBuckets(): CalendarSlot[] {
  return [
    ["07:00", "07:30"],
    ["07:30", "08:00"],
    ["08:00", "08:30"],
  ].map(([s, e], i) => ({
    id: `r${i}`,
    starts_at: `${DAY}T${s}:00.000Z`,
    ends_at: `${DAY}T${e}:00.000Z`,
    capacity_per_slot: 2,
    rule_id: "R1",
    excluded_at: null,
  }));
}

const oneoffLibre: CalendarSlot = {
  id: "a-libre",
  starts_at: `${DAY}T12:00:00.000Z`, // 14h Paris
  ends_at: `${DAY}T15:00:00.000Z`, // 17h Paris
  capacity_per_slot: 10,
  rule_id: null,
  excluded_at: null,
};

const oneoffRdv: CalendarSlot[] = [
  {
    id: "a-rdv-1",
    starts_at: `${DAY}T16:00:00.000Z`,
    ends_at: `${DAY}T16:30:00.000Z`,
    capacity_per_slot: 1,
    rule_id: null,
    excluded_at: null,
  },
  {
    id: "a-rdv-2",
    starts_at: `${DAY}T16:30:00.000Z`,
    ends_at: `${DAY}T17:00:00.000Z`,
    capacity_per_slot: 1,
    rule_id: null,
    excluded_at: null,
  },
];

function group(slots: CalendarSlot[], blocked: string[] = []) {
  return groupWeekSlots({
    dayKeys: DAY_KEYS,
    todayKey: DAY,
    slots,
    rules,
    blockedSlotIds: new Set(blocked),
  });
}

describe("parisDateKey", () => {
  it("mappe un timestamptz UTC sur la bonne date Paris", () => {
    expect(parisDateKey(`${DAY}T07:00:00.000Z`)).toBe("2026-06-03");
    // 23:00Z le 2 juin = 01:00 Paris le 3 juin
    expect(parisDateKey("2026-06-02T23:00:00.000Z")).toBe("2026-06-03");
  });
});

describe("groupWeekSlots", () => {
  it("collapse les tranches d'une règle récurrente en 1 bloc", () => {
    const days = group(recurringBuckets());
    const wed = days.find((d) => d.dateKey === DAY)!;
    const rec = wed.blocks.filter((b) => b.kind === "recurring");
    expect(rec).toHaveLength(1);
    expect(rec[0]!.slotCount).toBe(3);
    expect(rec[0]!.mode).toBe("rdv");
    expect(rec[0]!.capacity).toBe(2); // depuis la règle
    expect(rec[0]!.ruleId).toBe("R1");
    expect(rec[0]!.slotIds).toEqual(["r0", "r1", "r2"]);
  });

  it("ouverture ponctuelle libre = 1 bloc libre", () => {
    const days = group([oneoffLibre]);
    const wed = days.find((d) => d.dateKey === DAY)!;
    expect(wed.blocks).toHaveLength(1);
    expect(wed.blocks[0]!.kind).toBe("oneoff");
    expect(wed.blocks[0]!.mode).toBe("libre");
    expect(wed.blocks[0]!.capacity).toBe(10);
    expect(wed.blocks[0]!.slotCount).toBe(1);
  });

  it("fusionne les tranches ponctuelles contiguës de même capacité (rdv)", () => {
    const days = group(oneoffRdv);
    const wed = days.find((d) => d.dateKey === DAY)!;
    expect(wed.blocks).toHaveLength(1);
    expect(wed.blocks[0]!.mode).toBe("rdv");
    expect(wed.blocks[0]!.slotCount).toBe(2);
    expect(wed.blocks[0]!.slotIds).toEqual(["a-rdv-1", "a-rdv-2"]);
  });

  it("identifie un creneau reserve a un produit", () => {
    const days = group([
      { ...oneoffLibre, availability_scope: "product_restricted" },
    ]);
    const wed = days.find((d) => d.dateKey === DAY)!;
    expect(wed.blocks[0]!.availabilityScope).toBe("product_restricted");
  });

  it("ne fusionne pas un creneau reserve avec un creneau generique", () => {
    const days = group([
      {
        id: "shared",
        starts_at: `${DAY}T12:00:00.000Z`,
        ends_at: `${DAY}T13:00:00.000Z`,
        capacity_per_slot: 2,
        rule_id: null,
        excluded_at: null,
        availability_scope: "shared",
      },
      {
        id: "restricted",
        starts_at: `${DAY}T13:00:00.000Z`,
        ends_at: `${DAY}T14:00:00.000Z`,
        capacity_per_slot: 2,
        rule_id: null,
        excluded_at: null,
        availability_scope: "product_restricted",
      },
    ]);
    const wed = days.find((d) => d.dateKey === DAY)!;
    expect(wed.blocks).toHaveLength(2);
    expect(wed.blocks.map((b) => b.availabilityScope)).toEqual([
      "shared",
      "product_restricted",
    ]);
  });

  it("trie et sépare correctement règle / ponctuels d'un même jour", () => {
    const days = group([...recurringBuckets(), oneoffLibre, ...oneoffRdv]);
    const wed = days.find((d) => d.dateKey === DAY)!;
    expect(wed.blocks).toHaveLength(3); // 1 récurrent + 2 ponctuels
    expect(wed.blocks.map((b) => b.kind)).toEqual([
      "recurring",
      "oneoff",
      "oneoff",
    ]);
    expect(wed.isToday).toBe(true);
  });

  it("bloc fermé quand toutes les tranches sont exclues", () => {
    const excluded = recurringBuckets().map((s) => ({
      ...s,
      excluded_at: `${DAY}T10:00:00.000Z`,
    }));
    const days = group(excluded);
    const wed = days.find((d) => d.dateKey === DAY)!;
    expect(wed.blocks[0]!.excluded).toBe(true);
  });

  it("hasActiveOrder quand un slot du bloc est bloqué", () => {
    const days = group([oneoffLibre], ["a-libre"]);
    const wed = days.find((d) => d.dateKey === DAY)!;
    expect(wed.blocks[0]!.hasActiveOrder).toBe(true);
  });

  it("les autres jours de la semaine sont vides", () => {
    const days = group([oneoffLibre]);
    const others = days.filter((d) => d.dateKey !== DAY);
    expect(others.every((d) => d.blocks.length === 0)).toBe(true);
    expect(days).toHaveLength(7);
  });
});
