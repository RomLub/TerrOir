import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { detectBlockingOrdersForDates } from "@/lib/unavailabilities/detect-blocking-orders";

const PRODUCER_ID = "prod-1";

// Mock minimal du client admin : supporte
//   * from("slots").select(...).eq(...).gte(...).lt(...)
//   * from("orders").select(...).in(...).in(...).order(...)
function makeAdmin(opts: {
  slotsByDay?: Map<
    string,
    Array<{ id: string; starts_at: string; ends_at: string }>
  >;
  orders?: Array<{
    id: string;
    slot_id: string;
    producer_order_seq: number;
    montant_total: number;
    consumer?: { prenom: string | null } | null;
    producer?: { producer_number: number };
  }>;
  ordersError?: { message: string } | null;
}): SupabaseClient {
  return {
    from: (table: string) => {
      if (table === "slots") {
        const state: { gteValue: string | null } = { gteValue: null };
        const builder: any = {};
        builder.select = () => builder;
        builder.eq = () => builder;
        builder.gte = (_col: string, val: string) => {
          state.gteValue = val;
          return builder;
        };
        builder.lt = () => {
          // À ce stade on connaît startBoundary → résoudre le jour Paris.
          // On utilise le starts_at slice 0..10 (UTC) ; les mocks postent
          // déjà des bornes Paris matchant le YYYY-MM-DD UTC pour simplifier.
          const dayKey = state.gteValue?.slice(0, 10) ?? "";
          const rows = opts.slotsByDay?.get(dayKey) ?? [];
          return Promise.resolve({ data: rows, error: null });
        };
        return builder;
      }
      if (table === "orders") {
        const builder: any = {};
        builder.select = () => builder;
        builder.in = () => builder;
        builder.order = () =>
          Promise.resolve({
            data: opts.orders ?? [],
            error: opts.ordersError ?? null,
          });
        return builder;
      }
      throw new Error(`unexpected table: ${table}`);
    },
  } as unknown as SupabaseClient;
}

describe("detectBlockingOrdersForDates", () => {
  it("dates vides → []", async () => {
    const admin = makeAdmin({});
    const res = await detectBlockingOrdersForDates(admin, PRODUCER_ID, []);
    expect(res).toEqual([]);
  });

  it("aucun slot pour ces dates → []", async () => {
    const admin = makeAdmin({ slotsByDay: new Map() });
    const res = await detectBlockingOrdersForDates(admin, PRODUCER_ID, [
      "2099-08-14",
    ]);
    expect(res).toEqual([]);
  });

  it("slots présents mais aucune commande active → []", async () => {
    const admin = makeAdmin({
      slotsByDay: new Map([
        [
          "2099-08-14",
          [
            {
              id: "s1",
              starts_at: "2099-08-14T07:00:00.000Z",
              ends_at: "2099-08-14T07:30:00.000Z",
            },
          ],
        ],
      ]),
      orders: [],
    });
    const res = await detectBlockingOrdersForDates(admin, PRODUCER_ID, [
      "2099-08-14",
    ]);
    expect(res).toEqual([]);
  });

  it("commande active → BlockingOrderForUnavail avec shape complète + date_key Paris", async () => {
    const admin = makeAdmin({
      slotsByDay: new Map([
        [
          "2099-08-14",
          [
            {
              id: "s1",
              starts_at: "2099-08-14T07:00:00.000Z",
              ends_at: "2099-08-14T07:30:00.000Z",
            },
          ],
        ],
      ]),
      orders: [
        {
          id: "o-1",
          slot_id: "s1",
          producer_order_seq: 7,
          montant_total: 25.5,
          consumer: { prenom: "Léa" },
          producer: { producer_number: 42 },
        },
      ],
    });
    const res = await detectBlockingOrdersForDates(admin, PRODUCER_ID, [
      "2099-08-14",
    ]);
    expect(res).toHaveLength(1);
    expect(res[0]).toEqual({
      id: "o-1",
      numero_commande: "0042-00007",
      consumer_prenom: "Léa",
      montant_total: 25.5,
      slot_starts_at: "2099-08-14T07:00:00.000Z",
      slot_ends_at: "2099-08-14T07:30:00.000Z",
      date_key: "2099-08-14",
    });
  });

  it("dates dupliquées → de-dup avant fetch", async () => {
    const admin = makeAdmin({
      slotsByDay: new Map([
        [
          "2099-08-14",
          [
            {
              id: "s1",
              starts_at: "2099-08-14T07:00:00.000Z",
              ends_at: "2099-08-14T07:30:00.000Z",
            },
          ],
        ],
      ]),
      orders: [],
    });
    const res = await detectBlockingOrdersForDates(admin, PRODUCER_ID, [
      "2099-08-14",
      "2099-08-14",
    ]);
    expect(res).toEqual([]);
  });

  it("orders fetch error → []", async () => {
    const admin = makeAdmin({
      slotsByDay: new Map([
        [
          "2099-08-14",
          [
            {
              id: "s1",
              starts_at: "2099-08-14T07:00:00.000Z",
              ends_at: "2099-08-14T07:30:00.000Z",
            },
          ],
        ],
      ]),
      orders: undefined,
      ordersError: { message: "fetch boom" },
    });
    const res = await detectBlockingOrdersForDates(admin, PRODUCER_ID, [
      "2099-08-14",
    ]);
    expect(res).toEqual([]);
  });
});
