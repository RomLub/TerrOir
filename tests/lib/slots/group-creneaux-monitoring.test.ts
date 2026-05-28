import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  groupCreneauxMonitoring,
  type MonitoringSlot,
  type MonitoringRule,
  type MonitoringOrder,
} from "@/lib/slots/group-creneaux-monitoring";

// Helpers test : on construit des ISO en heure de Paris (mai = +02:00).
function iso(day: number, hour: number, minute = 0): string {
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `2026-05-${dd}T${hh}:${mm}:00+02:00`;
}

function dayKey(day: number): string {
  return `2026-05-${String(day).padStart(2, "0")}`;
}

const WEEK = [
  dayKey(25), // Lundi
  dayKey(26),
  dayKey(27),
  dayKey(28),
  dayKey(29),
  dayKey(30),
  dayKey(31), // Dimanche
];

const TODAY = dayKey(28);

function makeRule(opts: Partial<MonitoringRule> & { id: string }): MonitoringRule {
  return {
    id: opts.id,
    mode: opts.mode ?? "rdv",
    capacity_per_slot: opts.capacity_per_slot ?? 4,
    slot_duration_minutes: opts.slot_duration_minutes ?? 30,
  };
}

function makeSlot(opts: Partial<MonitoringSlot> & { id: string }): MonitoringSlot {
  return {
    id: opts.id,
    starts_at: opts.starts_at ?? iso(28, 9),
    ends_at: opts.ends_at ?? iso(28, 12),
    capacity_per_slot: opts.capacity_per_slot ?? 4,
    rule_id: opts.rule_id ?? null,
    excluded_at: opts.excluded_at ?? null,
  };
}

function makeOrder(opts: Partial<MonitoringOrder> & { id: string }): MonitoringOrder {
  return {
    id: opts.id,
    code: opts.code ?? "TRR-00001",
    consumerFirstName:
      opts.consumerFirstName === undefined ? "Jean" : opts.consumerFirstName,
    createdAt: opts.createdAt ?? "2026-05-20T10:00:00Z",
  };
}

describe("groupCreneauxMonitoring", () => {
  describe("mode libre", () => {
    it("1 slot cap 8 sans réservation → 8 cases libres", () => {
      const slot = makeSlot({
        id: "s1",
        rule_id: "r1",
        starts_at: iso(28, 9),
        ends_at: iso(28, 18),
        capacity_per_slot: 8,
      });
      const rule = makeRule({
        id: "r1",
        mode: "libre",
        capacity_per_slot: 8,
        slot_duration_minutes: 540,
      });
      const days = groupCreneauxMonitoring({
        dayKeys: WEEK,
        todayKey: TODAY,
        slots: [slot],
        rules: [rule],
        ordersBySlot: new Map(),
      });

      expect(days).toHaveLength(1);
      const day = days[0]!;
      expect(day.dateKey).toBe(dayKey(28));
      expect(day.weekdayLabel).toBe("Jeudi");
      expect(day.dayNum).toBe(28);
      expect(day.blocks).toHaveLength(1);

      const block = day.blocks[0]!;
      expect(block.mode).toBe("libre");
      expect(block.durationLabel).toBe("plage");
      expect(block.totalCapacity).toBe(8);
      expect(block.reservedCount).toBe(0);
      expect(block.cells).toHaveLength(8);
      expect(block.cells.every((c) => c.kind === "free")).toBe(true);
    });

    it("1 slot cap 8 avec 3 réservations → 3 reserved (ordre createdAt) + 5 free", () => {
      const slot = makeSlot({
        id: "s1",
        rule_id: "r1",
        starts_at: iso(28, 9),
        ends_at: iso(28, 18),
        capacity_per_slot: 8,
      });
      const rule = makeRule({
        id: "r1",
        mode: "libre",
        capacity_per_slot: 8,
        slot_duration_minutes: 540,
      });
      const o1 = makeOrder({ id: "o-c", code: "TRR-3", createdAt: "2026-05-20T12:00:00Z" });
      const o2 = makeOrder({ id: "o-a", code: "TRR-1", createdAt: "2026-05-20T10:00:00Z" });
      const o3 = makeOrder({ id: "o-b", code: "TRR-2", createdAt: "2026-05-20T11:00:00Z" });
      const days = groupCreneauxMonitoring({
        dayKeys: WEEK,
        todayKey: TODAY,
        slots: [slot],
        rules: [rule],
        ordersBySlot: new Map([["s1", [o1, o2, o3]]]),
      });

      const block = days[0]!.blocks[0]!;
      expect(block.reservedCount).toBe(3);
      const reserved = block.cells.filter((c) => c.kind === "reserved");
      expect(reserved).toHaveLength(3);
      // Ordre attendu : createdAt asc → o-a (10h), o-b (11h), o-c (12h)
      expect(
        reserved.map((c) =>
          c.kind === "reserved" ? c.orderCode : null,
        ),
      ).toEqual(["TRR-1", "TRR-2", "TRR-3"]);
      // Les 3 premières cases sont les réservées
      expect(block.cells[0]!.kind).toBe("reserved");
      expect(block.cells[1]!.kind).toBe("reserved");
      expect(block.cells[2]!.kind).toBe("reserved");
      expect(block.cells[3]!.kind).toBe("free");
      expect(block.cells[7]!.kind).toBe("free");
    });
  });

  describe("mode RDV", () => {
    it("RDV cap 4 sur 9h-12h en 30 min → 6 sous-slots × 4 = 24 cases", () => {
      const rule = makeRule({
        id: "r1",
        mode: "rdv",
        capacity_per_slot: 4,
        slot_duration_minutes: 30,
      });
      const slots: MonitoringSlot[] = [];
      for (let h = 0; h < 6; h++) {
        const startHour = 9 + Math.floor((h * 30) / 60);
        const startMin = (h * 30) % 60;
        const endHour = 9 + Math.floor(((h + 1) * 30) / 60);
        const endMin = ((h + 1) * 30) % 60;
        slots.push(
          makeSlot({
            id: `s${h}`,
            rule_id: "r1",
            starts_at: iso(28, startHour, startMin),
            ends_at: iso(28, endHour, endMin),
            capacity_per_slot: 4,
          }),
        );
      }
      const days = groupCreneauxMonitoring({
        dayKeys: WEEK,
        todayKey: TODAY,
        slots,
        rules: [rule],
        ordersBySlot: new Map(),
      });

      expect(days).toHaveLength(1);
      const block = days[0]!.blocks[0]!;
      expect(block.mode).toBe("rdv");
      expect(block.durationLabel).toBe("RDV 30 min");
      expect(block.totalCapacity).toBe(24);
      expect(block.cells).toHaveLength(24);
      expect(block.reservedCount).toBe(0);
    });

    it("RDV cap 4 avec 1 réservation sur le sous-slot 10h30 → case 13 reserved, le reste libre", () => {
      const rule = makeRule({
        id: "r1",
        mode: "rdv",
        capacity_per_slot: 4,
        slot_duration_minutes: 30,
      });
      const slots: MonitoringSlot[] = [];
      const slotStarts = [
        [9, 0],
        [9, 30],
        [10, 0],
        [10, 30],
        [11, 0],
        [11, 30],
      ] as const;
      slotStarts.forEach(([h, m], idx) => {
        const next = slotStarts[idx + 1];
        const endHour = next ? next[0] : 12;
        const endMin = next ? next[1] : 0;
        slots.push(
          makeSlot({
            id: `s-${h}-${m}`,
            rule_id: "r1",
            starts_at: iso(28, h, m),
            ends_at: iso(28, endHour, endMin),
            capacity_per_slot: 4,
          }),
        );
      });
      const order = makeOrder({ id: "o1", code: "TRR-42" });
      const days = groupCreneauxMonitoring({
        dayKeys: WEEK,
        todayKey: TODAY,
        slots,
        rules: [rule],
        ordersBySlot: new Map([["s-10-30", [order]]]),
      });

      const block = days[0]!.blocks[0]!;
      // Sous-slot 9h:  cases 0-3 libres
      // Sous-slot 9h30: cases 4-7 libres
      // Sous-slot 10h:  cases 8-11 libres
      // Sous-slot 10h30: case 12 réservée (1ʳᵉ place de ce sous-slot), 13-15 libres
      // Sous-slot 11h:  cases 16-19 libres
      // Sous-slot 11h30: cases 20-23 libres
      expect(block.reservedCount).toBe(1);
      expect(block.cells[11]!.kind).toBe("free");
      expect(block.cells[12]!.kind).toBe("reserved");
      if (block.cells[12]!.kind === "reserved") {
        expect(block.cells[12]!.orderCode).toBe("TRR-42");
        expect(block.cells[12]!.subSlotStartIso).toBe(iso(28, 10, 30));
      }
      expect(block.cells[13]!.kind).toBe("free");
      expect(block.cells[16]!.kind).toBe("free");
    });

    it("RDV cap 1 sur 9h-12h 15min → 12 cases (1 par sous-slot), 5 réservations dans 5 sous-slots distincts", () => {
      const rule = makeRule({
        id: "r1",
        mode: "rdv",
        capacity_per_slot: 1,
        slot_duration_minutes: 15,
      });
      const slots: MonitoringSlot[] = [];
      for (let k = 0; k < 12; k++) {
        const startMin = k * 15;
        const endMin = (k + 1) * 15;
        const sh = 9 + Math.floor(startMin / 60);
        const sm = startMin % 60;
        const eh = 9 + Math.floor(endMin / 60);
        const em = endMin % 60;
        slots.push(
          makeSlot({
            id: `s${k}`,
            rule_id: "r1",
            starts_at: iso(28, sh, sm),
            ends_at: iso(28, eh, em),
            capacity_per_slot: 1,
          }),
        );
      }
      const ordersBySlot = new Map<string, MonitoringOrder[]>([
        ["s0", [makeOrder({ id: "o0", code: "TRR-1" })]],
        ["s3", [makeOrder({ id: "o3", code: "TRR-2" })]],
        ["s5", [makeOrder({ id: "o5", code: "TRR-3" })]],
        ["s8", [makeOrder({ id: "o8", code: "TRR-4" })]],
        ["s11", [makeOrder({ id: "o11", code: "TRR-5" })]],
      ]);
      const days = groupCreneauxMonitoring({
        dayKeys: WEEK,
        todayKey: TODAY,
        slots,
        rules: [rule],
        ordersBySlot,
      });

      const block = days[0]!.blocks[0]!;
      expect(block.totalCapacity).toBe(12);
      expect(block.cells).toHaveLength(12);
      expect(block.reservedCount).toBe(5);
      expect(block.cells[0]!.kind).toBe("reserved");
      expect(block.cells[1]!.kind).toBe("free");
      expect(block.cells[3]!.kind).toBe("reserved");
      expect(block.cells[5]!.kind).toBe("reserved");
      expect(block.cells[8]!.kind).toBe("reserved");
      expect(block.cells[11]!.kind).toBe("reserved");
      expect(block.durationLabel).toBe("RDV 15 min");
    });
  });

  describe("ponctuels (rule_id null)", () => {
    it("2 sous-slots non contigus le même jour → 2 blocs distincts", () => {
      const slots: MonitoringSlot[] = [
        makeSlot({
          id: "a1",
          starts_at: iso(28, 9),
          ends_at: iso(28, 11),
          capacity_per_slot: 5,
          rule_id: null,
        }),
        makeSlot({
          id: "a2",
          starts_at: iso(28, 14),
          ends_at: iso(28, 17),
          capacity_per_slot: 3,
          rule_id: null,
        }),
      ];
      const days = groupCreneauxMonitoring({
        dayKeys: WEEK,
        todayKey: TODAY,
        slots,
        rules: [],
        ordersBySlot: new Map(),
      });

      expect(days[0]!.blocks).toHaveLength(2);
      expect(days[0]!.blocks[0]!.kind).toBe("oneoff");
      expect(days[0]!.blocks[0]!.totalCapacity).toBe(5);
      expect(days[0]!.blocks[0]!.mode).toBe("libre");
      expect(days[0]!.blocks[0]!.durationLabel).toBe("plage");
      expect(days[0]!.blocks[1]!.totalCapacity).toBe(3);
    });

    it("2 sous-slots contigus de même capacité → 1 bloc fusionné en mode rdv", () => {
      const slots: MonitoringSlot[] = [
        makeSlot({
          id: "a1",
          starts_at: iso(28, 9),
          ends_at: iso(28, 10),
          capacity_per_slot: 2,
          rule_id: null,
        }),
        makeSlot({
          id: "a2",
          starts_at: iso(28, 10),
          ends_at: iso(28, 11),
          capacity_per_slot: 2,
          rule_id: null,
        }),
      ];
      const days = groupCreneauxMonitoring({
        dayKeys: WEEK,
        todayKey: TODAY,
        slots,
        rules: [],
        ordersBySlot: new Map(),
      });

      expect(days[0]!.blocks).toHaveLength(1);
      const block = days[0]!.blocks[0]!;
      expect(block.kind).toBe("oneoff");
      expect(block.mode).toBe("rdv");
      expect(block.totalCapacity).toBe(4);
      expect(block.durationLabel).toBe("RDV 60 min");
    });
  });

  describe("exclusions", () => {
    it("bloc partiellement exclu : un sous-slot fermé → ses cases absentes", () => {
      const rule = makeRule({
        id: "r1",
        mode: "rdv",
        capacity_per_slot: 2,
        slot_duration_minutes: 60,
      });
      const slots: MonitoringSlot[] = [
        makeSlot({
          id: "s9",
          rule_id: "r1",
          starts_at: iso(28, 9),
          ends_at: iso(28, 10),
          capacity_per_slot: 2,
        }),
        makeSlot({
          id: "s10",
          rule_id: "r1",
          starts_at: iso(28, 10),
          ends_at: iso(28, 11),
          capacity_per_slot: 2,
          excluded_at: "2026-05-20T10:00:00Z",
        }),
        makeSlot({
          id: "s11",
          rule_id: "r1",
          starts_at: iso(28, 11),
          ends_at: iso(28, 12),
          capacity_per_slot: 2,
        }),
      ];
      const days = groupCreneauxMonitoring({
        dayKeys: WEEK,
        todayKey: TODAY,
        slots,
        rules: [rule],
        ordersBySlot: new Map(),
      });

      const block = days[0]!.blocks[0]!;
      // 2 sous-slots actifs × cap 2 = 4 cases (le sous-slot 10h-11h est exclu)
      expect(block.totalCapacity).toBe(4);
      expect(block.cells).toHaveLength(4);
      // Aucune case n'a starts_at = 10h
      expect(
        block.cells.every((c) => c.subSlotStartIso !== iso(28, 10)),
      ).toBe(true);
    });

    it("jour avec uniquement des sous-slots exclus → absent du retour", () => {
      const slots: MonitoringSlot[] = [
        makeSlot({
          id: "x1",
          starts_at: iso(28, 9),
          ends_at: iso(28, 12),
          excluded_at: "2026-05-20T10:00:00Z",
        }),
      ];
      const days = groupCreneauxMonitoring({
        dayKeys: WEEK,
        todayKey: TODAY,
        slots,
        rules: [],
        ordersBySlot: new Map(),
      });

      expect(days).toHaveLength(0);
    });
  });

  describe("filtrage jours vides", () => {
    it("semaine sans aucun slot → []", () => {
      const days = groupCreneauxMonitoring({
        dayKeys: WEEK,
        todayKey: TODAY,
        slots: [],
        rules: [],
        ordersBySlot: new Map(),
      });
      expect(days).toEqual([]);
    });

    it("seuls les jours actifs apparaissent (lundi + jeudi → 2 entrées)", () => {
      const slots: MonitoringSlot[] = [
        makeSlot({
          id: "lun",
          starts_at: iso(25, 9),
          ends_at: iso(25, 12),
          capacity_per_slot: 2,
        }),
        makeSlot({
          id: "jeu",
          starts_at: iso(28, 14),
          ends_at: iso(28, 17),
          capacity_per_slot: 3,
        }),
      ];
      const days = groupCreneauxMonitoring({
        dayKeys: WEEK,
        todayKey: TODAY,
        slots,
        rules: [],
        ordersBySlot: new Map(),
      });
      expect(days).toHaveLength(2);
      expect(days.map((d) => d.dateKey)).toEqual([dayKey(25), dayKey(28)]);
      expect(days[0]!.weekdayLabel).toBe("Lundi");
      expect(days[1]!.weekdayLabel).toBe("Jeudi");
    });
  });

  describe("edge cases", () => {
    it("orders.length > capacity → tronqué + warning", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const slot = makeSlot({
        id: "s1",
        rule_id: null,
        capacity_per_slot: 2,
        starts_at: iso(28, 9),
        ends_at: iso(28, 10),
      });
      const orders = [
        makeOrder({ id: "o1", createdAt: "2026-05-20T10:00:00Z" }),
        makeOrder({ id: "o2", createdAt: "2026-05-20T11:00:00Z" }),
        makeOrder({ id: "o3", createdAt: "2026-05-20T12:00:00Z" }),
      ];
      const days = groupCreneauxMonitoring({
        dayKeys: WEEK,
        todayKey: TODAY,
        slots: [slot],
        rules: [],
        ordersBySlot: new Map([["s1", orders]]),
      });

      const block = days[0]!.blocks[0]!;
      expect(block.cells).toHaveLength(2);
      expect(block.reservedCount).toBe(2);
      expect(warn).toHaveBeenCalledOnce();
      warn.mockRestore();
    });

    it("order avec consumerFirstName null → case réservée renvoie null", () => {
      const slot = makeSlot({
        id: "s1",
        capacity_per_slot: 1,
        starts_at: iso(28, 9),
        ends_at: iso(28, 10),
      });
      const order = makeOrder({ id: "o1", consumerFirstName: null });
      const days = groupCreneauxMonitoring({
        dayKeys: WEEK,
        todayKey: TODAY,
        slots: [slot],
        rules: [],
        ordersBySlot: new Map([["s1", [order]]]),
      });
      const cell = days[0]!.blocks[0]!.cells[0]!;
      expect(cell.kind).toBe("reserved");
      if (cell.kind === "reserved") {
        expect(cell.consumerFirstName).toBeNull();
      }
    });

    it("tie-break createdAt identique → tri par id ASC", () => {
      const slot = makeSlot({
        id: "s1",
        capacity_per_slot: 3,
        starts_at: iso(28, 9),
        ends_at: iso(28, 10),
      });
      const sameDate = "2026-05-20T10:00:00Z";
      const orders: MonitoringOrder[] = [
        makeOrder({ id: "zzz", code: "TRR-Z", createdAt: sameDate }),
        makeOrder({ id: "aaa", code: "TRR-A", createdAt: sameDate }),
        makeOrder({ id: "mmm", code: "TRR-M", createdAt: sameDate }),
      ];
      const days = groupCreneauxMonitoring({
        dayKeys: WEEK,
        todayKey: TODAY,
        slots: [slot],
        rules: [],
        ordersBySlot: new Map([["s1", orders]]),
      });
      const codes = days[0]!.blocks[0]!.cells.map((c) =>
        c.kind === "reserved" ? c.orderCode : null,
      );
      expect(codes).toEqual(["TRR-A", "TRR-M", "TRR-Z"]);
    });

    it("today flag positionné quand dateKey === todayKey", () => {
      const slot = makeSlot({
        id: "s1",
        starts_at: iso(28, 9),
        ends_at: iso(28, 10),
      });
      const days = groupCreneauxMonitoring({
        dayKeys: WEEK,
        todayKey: TODAY,
        slots: [slot],
        rules: [],
        ordersBySlot: new Map(),
      });
      expect(days[0]!.isToday).toBe(true);
    });

    it("agrège totalCapacity et reservedCount au niveau du jour", () => {
      const slots: MonitoringSlot[] = [
        makeSlot({
          id: "s1",
          starts_at: iso(28, 9),
          ends_at: iso(28, 12),
          capacity_per_slot: 4,
        }),
        makeSlot({
          id: "s2",
          starts_at: iso(28, 14),
          ends_at: iso(28, 17),
          capacity_per_slot: 8,
        }),
      ];
      const ordersBySlot = new Map<string, MonitoringOrder[]>([
        ["s1", [makeOrder({ id: "o1" }), makeOrder({ id: "o2" })]],
        ["s2", [makeOrder({ id: "o3" })]],
      ]);
      const days = groupCreneauxMonitoring({
        dayKeys: WEEK,
        todayKey: TODAY,
        slots,
        rules: [],
        ordersBySlot,
      });
      expect(days[0]!.blockCount).toBe(2);
      expect(days[0]!.totalCapacity).toBe(12);
      expect(days[0]!.reservedCount).toBe(3);
    });
  });
});

describe("groupCreneauxMonitoring — console warning isolation", () => {
  // Sanity check : pas de warning fuit hors du cas dédié.
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it("scénario nominal cap 8 / 0 reserved → 0 warning", () => {
    const slot: MonitoringSlot = {
      id: "s",
      starts_at: "2026-05-28T09:00:00+02:00",
      ends_at: "2026-05-28T18:00:00+02:00",
      capacity_per_slot: 8,
      rule_id: null,
      excluded_at: null,
    };
    groupCreneauxMonitoring({
      dayKeys: WEEK,
      todayKey: TODAY,
      slots: [slot],
      rules: [],
      ordersBySlot: new Map(),
    });
    expect(warn).not.toHaveBeenCalled();
  });
});
