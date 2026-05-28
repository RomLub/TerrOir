import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));
vi.mock("@/lib/slots/generate", () => ({
  invalidateProducer: vi.fn(),
}));
vi.mock("@/lib/unavailabilities/detect-blocking-orders", () => ({
  detectBlockingOrdersForDates: vi.fn(),
}));

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { detectBlockingOrdersForDates } from "@/lib/unavailabilities/detect-blocking-orders";
import { invalidateProducer } from "@/lib/slots/generate";
import { createUnavailabilities } from "@/lib/unavailabilities/create";

type Captured = {
  upsertedRows: Array<{
    producer_id: string;
    date: string;
    raison: string | null;
    created_by: string;
  }>;
  upsertOpts?: { onConflict?: string; ignoreDuplicates?: boolean };
  slotUpdates: Array<{ producer_id: string; payload: Record<string, unknown> }>;
};

function makeAdmin(opts?: {
  insertError?: { message: string };
  slotUpdateError?: { message: string };
}): { client: SupabaseClient; captured: Captured } {
  const captured: Captured = { upsertedRows: [], slotUpdates: [] };

  const client = {
    from: (table: string) => {
      if (table === "unavailabilities") {
        return {
          upsert: async (rows: any[], options: any) => {
            captured.upsertedRows.push(...rows);
            captured.upsertOpts = options;
            return { error: opts?.insertError ?? null };
          },
        };
      }
      if (table === "slots") {
        // slots UPDATE chain : .update({excluded_at}).eq("producer_id", X)
        //   .is("excluded_at", null).gte(...).lte(...)
        const state: { payload: Record<string, unknown> | null; producerId: string | null } = {
          payload: null,
          producerId: null,
        };
        const builder: any = {};
        builder.update = (payload: Record<string, unknown>) => {
          state.payload = payload;
          return builder;
        };
        builder.eq = (col: string, val: any) => {
          if (col === "producer_id") state.producerId = String(val);
          return builder;
        };
        builder.is = () => builder;
        builder.gte = () => builder;
        builder.lte = () => {
          // terminal : on capture et résout
          captured.slotUpdates.push({
            producer_id: state.producerId ?? "",
            payload: state.payload ?? {},
          });
          return Promise.resolve({ error: opts?.slotUpdateError ?? null });
        };
        return builder;
      }
      throw new Error(`unexpected table: ${table}`);
    },
  } as unknown as SupabaseClient;

  return { client, captured };
}

beforeEach(() => {
  vi.mocked(createSupabaseAdminClient).mockReset();
  vi.mocked(detectBlockingOrdersForDates).mockReset();
  vi.mocked(invalidateProducer).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

const PRODUCER_ID = "prod-1";
const CREATED_BY = "user-1";

describe("createUnavailabilities — validation input", () => {
  it("liste vide → INVALID_INPUT", async () => {
    const res = await createUnavailabilities({
      producerId: PRODUCER_ID,
      dates: [],
      raison: null,
      createdBy: CREATED_BY,
    });
    expect(res).toEqual({ error: expect.any(String), code: "INVALID_INPUT" });
  });

  it("> 90 dates → INVALID_INPUT", async () => {
    const dates = Array.from({ length: 91 }, (_, i) =>
      `2099-12-${String(((i % 28) + 1)).padStart(2, "0")}`,
    );
    const res = await createUnavailabilities({
      producerId: PRODUCER_ID,
      dates,
      raison: null,
      createdBy: CREATED_BY,
    });
    expect(res).toMatchObject({ code: "INVALID_INPUT" });
  });

  it("format date invalide → INVALID_INPUT", async () => {
    const res = await createUnavailabilities({
      producerId: PRODUCER_ID,
      dates: ["not-a-date"],
      raison: null,
      createdBy: CREATED_BY,
    });
    expect(res).toMatchObject({ code: "INVALID_INPUT" });
  });

  it("date passée → INVALID_INPUT", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
    const res = await createUnavailabilities({
      producerId: PRODUCER_ID,
      dates: ["2020-01-01"],
      raison: null,
      createdBy: CREATED_BY,
    });
    expect(res).toMatchObject({ code: "INVALID_INPUT" });
  });

  it("raison > 280 chars → INVALID_INPUT", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
    const res = await createUnavailabilities({
      producerId: PRODUCER_ID,
      dates: ["2099-01-01"],
      raison: "x".repeat(281),
      createdBy: CREATED_BY,
    });
    expect(res).toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("createUnavailabilities — blocking orders & upsert", () => {
  it("commandes actives détectées → BLOCKING_ORDERS avec liste, aucun upsert", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));

    const { client, captured } = makeAdmin();
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);
    vi.mocked(detectBlockingOrdersForDates).mockResolvedValue([
      {
        id: "o-1",
        numero_commande: "0042-00001",
        consumer_prenom: "Alice",
        montant_total: 30,
        slot_starts_at: "2099-08-14T07:00:00Z",
        slot_ends_at: "2099-08-14T07:30:00Z",
        date_key: "2099-08-14",
      },
    ]);

    const res = await createUnavailabilities({
      producerId: PRODUCER_ID,
      dates: ["2099-08-14"],
      raison: null,
      createdBy: CREATED_BY,
    });

    expect(res).toMatchObject({ code: "BLOCKING_ORDERS" });
    if ("blocking_orders" in res) {
      expect(res.blocking_orders).toHaveLength(1);
      expect(res.blocking_orders?.[0]?.consumer_prenom).toBe("Alice");
    }
    expect(captured.upsertedRows).toHaveLength(0);
    expect(captured.slotUpdates).toHaveLength(0);
    expect(invalidateProducer).not.toHaveBeenCalled();
  });

  it("aucune blocking + 2 dates : upsert idempotent + slots UPDATE excluded_at par date + invalidateProducer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));

    const { client, captured } = makeAdmin();
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);
    vi.mocked(detectBlockingOrdersForDates).mockResolvedValue([]);

    const res = await createUnavailabilities({
      producerId: PRODUCER_ID,
      dates: ["2099-08-14", "2099-08-15"],
      raison: "Congés été",
      createdBy: CREATED_BY,
    });

    expect(res).toEqual({ success: true, created_count: 2 });
    expect(captured.upsertedRows).toHaveLength(2);
    expect(captured.upsertedRows[0]).toEqual({
      producer_id: PRODUCER_ID,
      date: "2099-08-14",
      raison: "Congés été",
      created_by: CREATED_BY,
    });
    expect(captured.upsertOpts).toEqual({
      onConflict: "producer_id,date",
      ignoreDuplicates: true,
    });
    // 1 UPDATE slots par date sélectionnée
    expect(captured.slotUpdates).toHaveLength(2);
    for (const u of captured.slotUpdates) {
      expect(u.producer_id).toBe(PRODUCER_ID);
      expect(u.payload).toHaveProperty("excluded_at");
    }
    expect(invalidateProducer).toHaveBeenCalledWith(PRODUCER_ID);
  });

  it("idempotence : dates dupliquées → 1 seul upsert par date unique", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));

    const { client, captured } = makeAdmin();
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);
    vi.mocked(detectBlockingOrdersForDates).mockResolvedValue([]);

    const res = await createUnavailabilities({
      producerId: PRODUCER_ID,
      dates: ["2099-08-14", "2099-08-14", "2099-08-15"],
      raison: null,
      createdBy: CREATED_BY,
    });

    expect(res).toEqual({ success: true, created_count: 2 });
    expect(captured.upsertedRows).toHaveLength(2);
  });

  it("raison vide après trim → null persisté", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));

    const { client, captured } = makeAdmin();
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);
    vi.mocked(detectBlockingOrdersForDates).mockResolvedValue([]);

    await createUnavailabilities({
      producerId: PRODUCER_ID,
      dates: ["2099-08-14"],
      raison: "   ",
      createdBy: CREATED_BY,
    });

    expect(captured.upsertedRows[0]?.raison).toBeNull();
  });

  it("erreur INSERT → INTERNAL, aucun invalidateProducer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));

    const { client } = makeAdmin({ insertError: { message: "boom" } });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);
    vi.mocked(detectBlockingOrdersForDates).mockResolvedValue([]);

    const res = await createUnavailabilities({
      producerId: PRODUCER_ID,
      dates: ["2099-08-14"],
      raison: null,
      createdBy: CREATED_BY,
    });

    expect(res).toMatchObject({ code: "INTERNAL" });
    expect(invalidateProducer).not.toHaveBeenCalled();
  });
});
