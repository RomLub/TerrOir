import { describe, it, expect } from "vitest";
import {
  groupIntoBands,
  type DashboardSlotPayload,
  type DashboardOrderEntry,
} from "@/lib/slots/group-into-bands";

// Tous les ISO sont en UTC. Mai 2026 = CEST (UTC+2). Les bornes Paris
// se déduisent en ajoutant 2h. Le helper utilise la TZ Paris pour
// constituer la clé de jour des rules ; le tri global passe par
// Date.parse (UTC ms-à-ms), donc identique entre TZ.

const RULE_A = "11111111-1111-1111-1111-111111111111";
const RULE_B = "22222222-2222-2222-2222-222222222222";

function order(
  id: string,
  code: string,
  starts_at: string,
): DashboardOrderEntry {
  return { order_id: id, code_commande: code, starts_at };
}

function slot(params: {
  id: string;
  starts_at: string;
  ends_at: string;
  rule_id: string | null;
  orders?: DashboardOrderEntry[];
  capacity_per_slot?: number;
}): DashboardSlotPayload {
  const orders = params.orders ?? [];
  return {
    id: params.id,
    starts_at: params.starts_at,
    ends_at: params.ends_at,
    capacity_per_slot: params.capacity_per_slot ?? 5,
    rule_id: params.rule_id,
    orders_count: orders.length,
    orders,
  };
}

describe("groupIntoBands — slots avec rule_id", () => {
  it("slots issus d'une même rule un même jour → 1 bande", () => {
    const slots = [
      slot({
        id: "s1",
        starts_at: "2026-06-03T07:00:00.000Z",
        ends_at: "2026-06-03T07:30:00.000Z",
        rule_id: RULE_A,
      }),
      slot({
        id: "s2",
        starts_at: "2026-06-03T07:30:00.000Z",
        ends_at: "2026-06-03T08:00:00.000Z",
        rule_id: RULE_A,
      }),
      slot({
        id: "s3",
        starts_at: "2026-06-03T08:00:00.000Z",
        ends_at: "2026-06-03T09:00:00.000Z",
        rule_id: RULE_A,
      }),
    ];
    const bands = groupIntoBands(slots);
    expect(bands).toHaveLength(1);
    const b = bands[0]!;
    expect(b.source).toBe("rule");
    expect(b.ruleId).toBe(RULE_A);
    expect(b.startsAt).toBe("2026-06-03T07:00:00.000Z");
    expect(b.endsAt).toBe("2026-06-03T09:00:00.000Z");
    expect(b.totalOrders).toBe(0);
  });

  it("slots d'une même rule sur deux jours différents → 2 bandes", () => {
    const slots = [
      slot({
        id: "s1",
        starts_at: "2026-06-03T07:00:00.000Z",
        ends_at: "2026-06-03T09:00:00.000Z",
        rule_id: RULE_A,
      }),
      slot({
        id: "s2",
        starts_at: "2026-06-04T07:00:00.000Z",
        ends_at: "2026-06-04T09:00:00.000Z",
        rule_id: RULE_A,
      }),
    ];
    const bands = groupIntoBands(slots);
    expect(bands).toHaveLength(2);
    expect(bands.map((b) => b.startsAt)).toEqual([
      "2026-06-03T07:00:00.000Z",
      "2026-06-04T07:00:00.000Z",
    ]);
    expect(bands.every((b) => b.ruleId === RULE_A)).toBe(true);
  });

  it("slots de deux rules différentes le même jour → 2 bandes distinctes", () => {
    const slots = [
      slot({
        id: "s1",
        starts_at: "2026-06-03T07:00:00.000Z",
        ends_at: "2026-06-03T09:00:00.000Z",
        rule_id: RULE_A,
      }),
      slot({
        id: "s2",
        starts_at: "2026-06-03T13:00:00.000Z",
        ends_at: "2026-06-03T15:00:00.000Z",
        rule_id: RULE_B,
      }),
    ];
    const bands = groupIntoBands(slots);
    expect(bands).toHaveLength(2);
    expect(bands[0]!.ruleId).toBe(RULE_A);
    expect(bands[1]!.ruleId).toBe(RULE_B);
  });
});

describe("groupIntoBands — slots ponctuels (rule_id null)", () => {
  it("8 slots ponctuels contigus 14h-16h en tranches 15min → 1 bande", () => {
    const base = Date.parse("2026-06-03T12:00:00.000Z");
    const slots: DashboardSlotPayload[] = [];
    for (let i = 0; i < 8; i++) {
      const startMs = base + i * 15 * 60_000;
      const endMs = startMs + 15 * 60_000;
      slots.push(
        slot({
          id: `a${i}`,
          starts_at: new Date(startMs).toISOString(),
          ends_at: new Date(endMs).toISOString(),
          rule_id: null,
        }),
      );
    }
    const bands = groupIntoBands(slots);
    expect(bands).toHaveLength(1);
    expect(bands[0]!.source).toBe("adhoc");
    expect(bands[0]!.ruleId).toBeNull();
    expect(bands[0]!.startsAt).toBe("2026-06-03T12:00:00.000Z");
    expect(bands[0]!.endsAt).toBe("2026-06-03T14:00:00.000Z");
  });

  it("slots ponctuels avec gap intra-journée → 2 bandes distinctes", () => {
    const slots = [
      slot({
        id: "a1",
        starts_at: "2026-06-03T07:00:00.000Z",
        ends_at: "2026-06-03T08:00:00.000Z",
        rule_id: null,
      }),
      slot({
        id: "a2",
        starts_at: "2026-06-03T13:00:00.000Z",
        ends_at: "2026-06-03T14:00:00.000Z",
        rule_id: null,
      }),
    ];
    const bands = groupIntoBands(slots);
    expect(bands).toHaveLength(2);
    expect(bands.every((b) => b.source === "adhoc")).toBe(true);
  });

  it("slot ponctuel isolé (1 seul slot, mode libre) → 1 bande", () => {
    const slots = [
      slot({
        id: "a1",
        starts_at: "2026-06-03T10:00:00.000Z",
        ends_at: "2026-06-03T12:00:00.000Z",
        rule_id: null,
      }),
    ];
    const bands = groupIntoBands(slots);
    expect(bands).toHaveLength(1);
    expect(bands[0]!.source).toBe("adhoc");
    expect(bands[0]!.startsAt).toBe("2026-06-03T10:00:00.000Z");
    expect(bands[0]!.endsAt).toBe("2026-06-03T12:00:00.000Z");
  });
});

describe("groupIntoBands — mix + agrégation orders", () => {
  it("mix rule + ponctuel le même jour → 2 bandes distinctes", () => {
    const slots = [
      slot({
        id: "s1",
        starts_at: "2026-06-03T07:00:00.000Z",
        ends_at: "2026-06-03T09:00:00.000Z",
        rule_id: RULE_A,
      }),
      slot({
        id: "a1",
        starts_at: "2026-06-03T13:00:00.000Z",
        ends_at: "2026-06-03T15:00:00.000Z",
        rule_id: null,
      }),
    ];
    const bands = groupIntoBands(slots);
    expect(bands).toHaveLength(2);
    expect(bands[0]!.source).toBe("rule");
    expect(bands[1]!.source).toBe("adhoc");
  });

  it("totalOrders = somme cohérente + orders triés par code_commande", () => {
    const slots = [
      slot({
        id: "s1",
        starts_at: "2026-06-03T07:00:00.000Z",
        ends_at: "2026-06-03T07:30:00.000Z",
        rule_id: RULE_A,
        orders: [
          order("o1", "TRR-ZZZ01", "2026-06-03T07:00:00.000Z"),
          order("o2", "TRR-AAA01", "2026-06-03T07:00:00.000Z"),
        ],
      }),
      slot({
        id: "s2",
        starts_at: "2026-06-03T07:30:00.000Z",
        ends_at: "2026-06-03T08:00:00.000Z",
        rule_id: RULE_A,
        orders: [order("o3", "TRR-MMM01", "2026-06-03T07:30:00.000Z")],
      }),
    ];
    const bands = groupIntoBands(slots);
    expect(bands).toHaveLength(1);
    const b = bands[0]!;
    expect(b.totalOrders).toBe(3);
    expect(b.orders.map((o) => o.code_commande)).toEqual([
      "TRR-AAA01",
      "TRR-MMM01",
      "TRR-ZZZ01",
    ]);
  });

  it("invariant len(orders) === totalOrders dans tous les cas", () => {
    const slots = [
      slot({
        id: "s1",
        starts_at: "2026-06-03T07:00:00.000Z",
        ends_at: "2026-06-03T07:30:00.000Z",
        rule_id: RULE_A,
        orders: [order("o1", "TRR-AAA", "2026-06-03T07:00:00.000Z")],
      }),
      slot({
        id: "s2",
        starts_at: "2026-06-03T07:30:00.000Z",
        ends_at: "2026-06-03T08:00:00.000Z",
        rule_id: RULE_A,
        orders: [
          order("o2", "TRR-BBB", "2026-06-03T07:30:00.000Z"),
          order("o3", "TRR-CCC", "2026-06-03T07:30:00.000Z"),
        ],
      }),
      slot({
        id: "a1",
        starts_at: "2026-06-03T13:00:00.000Z",
        ends_at: "2026-06-03T14:00:00.000Z",
        rule_id: null,
        orders: [order("o4", "TRR-DDD", "2026-06-03T13:00:00.000Z")],
      }),
    ];
    const bands = groupIntoBands(slots);
    expect(bands).toHaveLength(2);
    for (const b of bands) {
      expect(b.orders.length).toBe(b.totalOrders);
    }
  });

  it("entrée vide → tableau vide (robustesse)", () => {
    expect(groupIntoBands([])).toEqual([]);
  });
});
