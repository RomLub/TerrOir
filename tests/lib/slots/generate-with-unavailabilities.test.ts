import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  generateSlotsForProducer,
  generateSlotsForProducerOnDate,
} from "@/lib/slots/generate";

// Suite dédiée aux invariants de la garde unavailabilities (chantier
// 2026-05-28, ADR-0009). Couvre :
//   * Aucune indispo → comportement strictement inchangé (régression test).
//   * Indispo posée → jour skip à la matérialisation (full horizon).
//   * generateSlotsForProducerOnDate : régénération ciblée respecte la
//     garde et bypass le TTL.

type SlotRuleMock = {
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

function makeSupabase(
  rules: SlotRuleMock[],
  unavailableDates: string[] = [],
): {
  client: SupabaseClient;
  upserted: Array<{ starts_at: string; ends_at: string }>;
} {
  const upserted: Array<{ starts_at: string; ends_at: string }> = [];
  const client = {
    from: (table: string) => {
      if (table === "slot_rules") {
        const builder: any = {};
        builder.select = () => builder;
        builder.eq = () => builder;
        builder.then = (fn: any) => fn({ data: rules, error: null });
        return builder;
      }
      if (table === "unavailabilities") {
        const builder: any = {};
        builder.select = () => builder;
        builder.eq = () => builder;
        builder.gte = () => builder;
        builder.lte = () => builder;
        builder.then = (fn: any) =>
          fn({
            data: unavailableDates.map((d) => ({ date: d })),
            error: null,
          });
        return builder;
      }
      if (table === "slots") {
        return {
          upsert: async (rows: any[]) => {
            upserted.push(...rows);
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  } as unknown as SupabaseClient;
  return { client, upserted };
}

let counter = 0;
function uniqueProducerId(): string {
  counter++;
  return `prod-unavail-${counter}`;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const RULE_HEBDO_THU_9_12 = (producerId: string): SlotRuleMock => ({
  id: "rule-thu",
  producer_id: producerId,
  days_of_week: [4], // jeudi
  periodicity_weeks: 1,
  start_time: "09:00:00",
  end_time: "12:00:00",
  slot_duration_minutes: 30,
  capacity_per_slot: 5,
  // Lundi 2026-01-05 — début de semaine ISO contenant le 1er jeudi.
  created_at: "2026-01-05T00:00:00.000Z",
});

describe("generateSlotsForProducer — garde unavailabilities", () => {
  it("aucune indispo : matérialise tous les jeudis sur 28j (régression test)", async () => {
    vi.setSystemTime(new Date("2026-01-04T23:00:00.000Z"));
    const producerId = uniqueProducerId();
    const { client, upserted } = makeSupabase([RULE_HEBDO_THU_9_12(producerId)]);

    const res = await generateSlotsForProducer(client, producerId, 28);

    // 4 jeudis (8, 15, 22, 29 jan) × 6 slots = 24
    expect(res.inserted).toBe(24);
    expect(upserted).toHaveLength(24);
  });

  it("indispo posée le jeudi 15 jan : ce jour ne génère AUCUN slot", async () => {
    vi.setSystemTime(new Date("2026-01-04T23:00:00.000Z"));
    const producerId = uniqueProducerId();
    const { client, upserted } = makeSupabase(
      [RULE_HEBDO_THU_9_12(producerId)],
      ["2026-01-15"],
    );

    const res = await generateSlotsForProducer(client, producerId, 28);

    // 3 jeudis restants (8, 22, 29) × 6 = 18
    expect(res.inserted).toBe(18);
    expect(upserted).toHaveLength(18);
    // Aucun starts_at sur 2026-01-15
    for (const row of upserted) {
      expect(row.starts_at.slice(0, 10)).not.toBe("2026-01-15");
    }
  });

  it("scénario ADR : règle récurrente créée APRÈS indispo → jeudi indispo non généré", async () => {
    // Indispo posée AVANT que la rule existe (logique : le producteur a posé
    // ses vacances en mai, puis créé la règle "tous les jeudis" en juin).
    // La garde générative protège : même si la rule couvre théoriquement le
    // 15 jan, aucun slot n'est créé.
    vi.setSystemTime(new Date("2026-01-04T23:00:00.000Z"));
    const producerId = uniqueProducerId();
    const { client, upserted } = makeSupabase(
      [RULE_HEBDO_THU_9_12(producerId)],
      ["2026-01-15", "2026-01-22"],
    );

    const res = await generateSlotsForProducer(client, producerId, 28);

    // Restent 2 jeudis (8, 29) × 6 = 12
    expect(res.inserted).toBe(12);
    for (const row of upserted) {
      const day = row.starts_at.slice(0, 10);
      expect(day).not.toBe("2026-01-15");
      expect(day).not.toBe("2026-01-22");
    }
  });
});

describe("generateSlotsForProducerOnDate — régénération ciblée", () => {
  it("régénère uniquement les slots du jour ciblé selon la rule active", async () => {
    vi.setSystemTime(new Date("2026-01-04T23:00:00.000Z"));
    const producerId = uniqueProducerId();
    const { client, upserted } = makeSupabase([RULE_HEBDO_THU_9_12(producerId)]);

    // 8 jan = jeudi → 6 slots attendus, AUCUN autre jour.
    const res = await generateSlotsForProducerOnDate(
      client,
      producerId,
      "2026-01-08",
    );

    expect(res.inserted).toBe(6);
    expect(upserted).toHaveLength(6);
    for (const row of upserted) {
      expect(row.starts_at.slice(0, 10)).toBe("2026-01-08");
    }
  });

  it("date ciblée non-couverte par la rule (mardi) → 0 slot", async () => {
    vi.setSystemTime(new Date("2026-01-04T23:00:00.000Z"));
    const producerId = uniqueProducerId();
    const { client, upserted } = makeSupabase([RULE_HEBDO_THU_9_12(producerId)]);

    // 13 jan = mardi → rule (jeudi only) ne s'applique pas
    const res = await generateSlotsForProducerOnDate(
      client,
      producerId,
      "2026-01-13",
    );

    expect(res.inserted).toBe(0);
    expect(upserted).toHaveLength(0);
  });

  it("si une indispo couvre ENCORE le jour (course concurrente) : 0 slot", async () => {
    vi.setSystemTime(new Date("2026-01-04T23:00:00.000Z"));
    const producerId = uniqueProducerId();
    const { client, upserted } = makeSupabase(
      [RULE_HEBDO_THU_9_12(producerId)],
      ["2026-01-08"],
    );

    const res = await generateSlotsForProducerOnDate(
      client,
      producerId,
      "2026-01-08",
    );

    expect(res.inserted).toBe(0);
    expect(upserted).toHaveLength(0);
  });

  it("date au format invalide → throw explicite", async () => {
    const producerId = uniqueProducerId();
    const { client } = makeSupabase([]);
    await expect(
      generateSlotsForProducerOnDate(client, producerId, "not-a-date"),
    ).rejects.toThrow(/date invalide/);
  });
});
