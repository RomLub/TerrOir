import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  generateSlotsForProducer,
  invalidateProducer,
} from "@/lib/slots/generate";

// Mock Supabase client minimal : supporte seulement les appels utilisés par
// generate.ts → `.from('slot_rules').select(...).eq(...).eq(...)` (thenable)
// et `.from('slots').upsert(rows, opts)` (Promise). Les filtres eq() sont
// ignorés : on retourne directement le dataset configuré par le test.
type SlotRuleMock = {
  id: string;
  producer_id: string;
  days_of_week: number[];
  periodicity_weeks: number;
  start_time: string;
  end_time: string;
  slot_duration_minutes: number;
  capacity_per_slot: number;
  availability_scope?: "shared" | "product_restricted" | null;
  created_at: string;
};

type Captured = {
  slotRulesCalls: number;
  slotsUpsertCalls: number;
  upsertedRows: Array<{
    rule_id: string;
    producer_id: string;
    starts_at: string;
    ends_at: string;
    capacity_per_slot: number;
    availability_scope?: "shared" | "product_restricted";
  }>;
  upsertOpts?: { onConflict?: string; ignoreDuplicates?: boolean };
};

function makeSupabase(
  rules: SlotRuleMock[],
  unavailableDates: string[] = [],
): {
  client: SupabaseClient;
  captured: Captured;
} {
  const captured: Captured = {
    slotRulesCalls: 0,
    slotsUpsertCalls: 0,
    upsertedRows: [],
  };

  const client = {
    from: (table: string) => {
      if (table === "slot_rules") {
        captured.slotRulesCalls++;
        const resp = { data: rules, error: null };
        const builder: any = {};
        builder.select = () => builder;
        builder.eq = () => builder;
        builder.then = (onFulfilled: any) => onFulfilled(resp);
        return builder;
      }
      if (table === "unavailabilities") {
        // Garde unavailabilities (chantier 2026-05-28). Le builder retourne
        // les dates fournies, peu importe les filtres .gte()/.lte().
        const resp = {
          data: unavailableDates.map((d) => ({ date: d })),
          error: null,
        };
        const builder: any = {};
        builder.select = () => builder;
        builder.eq = () => builder;
        builder.gte = () => builder;
        builder.lte = () => builder;
        builder.then = (onFulfilled: any) => onFulfilled(resp);
        return builder;
      }
      if (table === "slots") {
        return {
          upsert: async (rows: any[], opts: any) => {
            captured.slotsUpsertCalls++;
            captured.upsertedRows.push(...rows);
            captured.upsertOpts = opts;
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  } as unknown as SupabaseClient;

  return { client, captured };
}

// Chaque test utilise un producer_id distinct pour ne pas être pollué par le
// mémo TTL module-scope de generate.ts.
let counter = 0;
function uniqueProducerId(): string {
  counter++;
  return `producer-test-${counter}`;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("generateSlotsForProducer", () => {
  it("rule hebdo mar+jeu 9-12h durée 30min → 48 slots sur 28 jours", async () => {
    // Lundi 2026-01-05 00:00 Europe/Paris (CET UTC+1) = 2026-01-04 23:00 UTC
    vi.setSystemTime(new Date("2026-01-04T23:00:00.000Z"));

    const producerId = uniqueProducerId();
    const { client, captured } = makeSupabase([
      {
        id: "rule-1",
        producer_id: producerId,
        days_of_week: [2, 4], // mardi, jeudi
        periodicity_weeks: 1,
        start_time: "09:00:00",
        end_time: "12:00:00",
        slot_duration_minutes: 30,
        capacity_per_slot: 5,
        created_at: "2026-01-05T00:00:00.000Z",
      },
    ]);

    const res = await generateSlotsForProducer(client, producerId, 28);

    // 4 mardis (6, 13, 20, 27 jan) + 4 jeudis (8, 15, 22, 29 jan) = 8 jours
    // 6 slots par jour (9h, 9h30, 10h, 10h30, 11h, 11h30) = 48 slots
    expect(res.inserted).toBe(48);
    expect(captured.upsertedRows).toHaveLength(48);
    expect(captured.upsertOpts).toEqual({
      onConflict: "producer_id,starts_at",
      ignoreDuplicates: true,
    });
    // Premier slot = mardi 6 jan 9h00 Paris (CET) = 08:00 UTC
    expect(captured.upsertedRows[0]?.starts_at).toBe(
      "2026-01-06T08:00:00.000Z",
    );
    expect(captured.upsertedRows[0]?.capacity_per_slot).toBe(5);
    expect(captured.upsertedRows[0]?.availability_scope).toBe("shared");
  });

  it("availability_scope product_restricted est herite depuis la rule", async () => {
    vi.setSystemTime(new Date("2026-01-04T23:00:00.000Z"));

    const producerId = uniqueProducerId();
    const { client, captured } = makeSupabase([
      {
        id: "rule-restricted",
        producer_id: producerId,
        days_of_week: [1],
        periodicity_weeks: 1,
        start_time: "09:00:00",
        end_time: "10:00:00",
        slot_duration_minutes: 60,
        capacity_per_slot: 1,
        availability_scope: "product_restricted",
        created_at: "2026-01-05T00:00:00.000Z",
      },
    ]);

    const res = await generateSlotsForProducer(client, producerId, 7);

    expect(res.inserted).toBe(1);
    expect(captured.upsertedRows[0]?.availability_scope).toBe(
      "product_restricted",
    );
  });

  it("periodicity 2 semaines → skip une semaine sur deux", async () => {
    vi.setSystemTime(new Date("2026-01-04T23:00:00.000Z")); // Lun 5 jan 00:00 Paris

    const producerId = uniqueProducerId();
    const { client, captured } = makeSupabase([
      {
        id: "rule-p2",
        producer_id: producerId,
        days_of_week: [1], // lundi
        periodicity_weeks: 2,
        start_time: "09:00:00",
        end_time: "12:00:00",
        slot_duration_minutes: 60,
        capacity_per_slot: 3,
        created_at: "2026-01-05T00:00:00.000Z",
      },
    ]);

    const res = await generateSlotsForProducer(client, producerId, 28);

    // Mondays in horizon: 5, 12, 19, 26 jan. Anchor = 5 jan.
    // weeksSince: 0, 1, 2, 3 → kept: 0 (Jan 5) et 2 (Jan 19) = 2 jours
    // 3 slots/jour (60min sur 3h) = 6 slots
    expect(res.inserted).toBe(6);
    const starts = captured.upsertedRows.map((r) => r.starts_at);
    expect(starts).toEqual([
      "2026-01-05T08:00:00.000Z",
      "2026-01-05T09:00:00.000Z",
      "2026-01-05T10:00:00.000Z",
      "2026-01-19T08:00:00.000Z",
      "2026-01-19T09:00:00.000Z",
      "2026-01-19T10:00:00.000Z",
    ]);
  });

  it("mémo TTL 15 min → 2e appel skip, invalidate le ré-autorise", async () => {
    vi.setSystemTime(new Date("2026-01-04T23:00:00.000Z"));
    const producerId = uniqueProducerId();
    const { client, captured } = makeSupabase([
      {
        id: "rule-ttl",
        producer_id: producerId,
        days_of_week: [1],
        periodicity_weeks: 1,
        start_time: "09:00:00",
        end_time: "10:00:00",
        slot_duration_minutes: 30,
        capacity_per_slot: 1,
        created_at: "2026-01-05T00:00:00.000Z",
      },
    ]);

    const r1 = await generateSlotsForProducer(client, producerId, 7);
    expect(r1.inserted).toBeGreaterThan(0);
    expect(captured.slotRulesCalls).toBe(1);

    // 2e appel dans la fenêtre TTL : skip silencieux, pas de SELECT
    const r2 = await generateSlotsForProducer(client, producerId, 7);
    expect(r2.inserted).toBe(0);
    expect(captured.slotRulesCalls).toBe(1);

    invalidateProducer(producerId);
    const r3 = await generateSlotsForProducer(client, producerId, 7);
    expect(r3.inserted).toBeGreaterThan(0);
    expect(captured.slotRulesCalls).toBe(2);
  });

  it("TZ Europe/Paris : slots avant et après bascule DST (mars 2026)", async () => {
    // Vendredi 2026-03-27 00:00 Paris (CET UTC+1) = 2026-03-26 23:00 UTC
    // DST : nuit du 28 au 29 mars, 02:00 → 03:00 CEST (UTC+2)
    vi.setSystemTime(new Date("2026-03-26T23:00:00.000Z"));

    const producerId = uniqueProducerId();
    const { client, captured } = makeSupabase([
      {
        id: "rule-dst",
        producer_id: producerId,
        days_of_week: [5, 6, 0], // vendredi, samedi, dimanche
        periodicity_weeks: 1,
        start_time: "09:00:00",
        end_time: "09:30:00",
        slot_duration_minutes: 30,
        capacity_per_slot: 1,
        created_at: "2026-03-01T00:00:00.000Z",
      },
    ]);

    const res = await generateSlotsForProducer(client, producerId, 3);

    // d=0 vendredi 27 mars (CET) → 09:00 Paris = 08:00 UTC
    // d=1 samedi 28 mars (CET)  → 09:00 Paris = 08:00 UTC
    // d=2 dimanche 29 mars (CEST après DST) → 09:00 Paris = 07:00 UTC
    expect(res.inserted).toBe(3);
    const starts = captured.upsertedRows.map((r) => r.starts_at);
    expect(starts).toEqual([
      "2026-03-27T08:00:00.000Z",
      "2026-03-28T08:00:00.000Z",
      "2026-03-29T07:00:00.000Z",
    ]);
  });

  it("aucune rule active → { inserted: 0 } et pas d'upsert", async () => {
    vi.setSystemTime(new Date("2026-01-04T23:00:00.000Z"));
    const producerId = uniqueProducerId();
    const { client, captured } = makeSupabase([]);

    const res = await generateSlotsForProducer(client, producerId, 28);
    expect(res.inserted).toBe(0);
    expect(captured.slotsUpsertCalls).toBe(0);
  });
});
