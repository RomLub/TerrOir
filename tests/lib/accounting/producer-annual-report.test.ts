import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  annualReportPeriod,
  buildProducerAnnualReportData,
} from "@/lib/accounting/producer-annual-report";
import type { Database } from "@/lib/types/database.types";

type DbResponse = {
  data: unknown;
  error: { message: string } | null;
};

type Capture = {
  filters: Array<[string, string, unknown]>;
  ranges: Array<[string, string, unknown]>;
  inFilters: Array<[string, string, unknown[]]>;
};

function makeAdmin(args: {
  producer: DbResponse;
  orders: DbResponse;
  orderItems?: DbResponse;
  payouts?: DbResponse;
  capture?: Capture;
}): SupabaseClient<Database> {
  const capture = args.capture;

  const admin = {
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          capture?.filters.push([table, column, value]);
          return builder;
        },
        gte: (column: string, value: unknown) => {
          capture?.ranges.push([table, column, value]);
          return builder;
        },
        lte: (column: string, value: unknown) => {
          capture?.ranges.push([table, column, value]);
          return builder;
        },
        in: (column: string, values: unknown[]) => {
          capture?.inFilters.push([table, column, values]);
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => Promise.resolve(args.producer),
        then: (resolve: (value: DbResponse) => unknown) => {
          if (table === "orders") return Promise.resolve(resolve(args.orders));
          if (table === "order_items") {
            return Promise.resolve(
              resolve(args.orderItems ?? { data: [], error: null }),
            );
          }
          if (table === "payouts") {
            return Promise.resolve(
              resolve(args.payouts ?? { data: [], error: null }),
            );
          }
          return Promise.resolve(resolve({ data: [], error: null }));
        },
      };
      return builder;
    },
  };

  return admin as unknown as SupabaseClient<Database>;
}

const producer = {
  id: "producer-1",
  nom_exploitation: "Ferme du Pré",
  siret: "12345678901234",
  producer_number: 42,
  user: { prenom: "Romain", nom: "Martin", email: "romain@example.fr" },
};

describe("buildProducerAnnualReportData", () => {
  it("utilise l'année sélectionnée et agrège les chiffres mensuels", async () => {
    const capture: Capture = { filters: [], ranges: [], inFilters: [] };

    const data = await buildProducerAnnualReportData({
      admin: makeAdmin({
        producer: { data: producer, error: null },
        orders: {
          data: [
            {
              id: "order-jan",
              completed_at: "2026-01-12T10:00:00.000Z",
              statut: "completed",
              montant_total: 30,
              commission_terroir: 1.8,
              montant_net_producteur: 28.2,
              producer_order_seq: 1,
              consumer_id: "consumer-1",
              consumer: { email: "a@example.fr" },
            },
            {
              id: "order-feb",
              completed_at: "2026-02-03T10:00:00.000Z",
              statut: "completed",
              montant_total: 70,
              commission_terroir: 4.2,
              montant_net_producteur: 65.8,
              producer_order_seq: 2,
              consumer_id: "consumer-2",
              consumer: { email: "b@example.fr" },
            },
          ],
          error: null,
        },
        orderItems: { data: [], error: null },
        capture,
      }),
      userId: "user-1",
      year: 2026,
      generatedAt: new Date("2026-05-28T12:00:00.000Z"),
    });

    expect(data.year).toBe(2026);
    expect(data.period.from).toBe("2026-01-01");
    expect(data.period.to).toBe("2026-12-31");
    expect(data.monthly).toHaveLength(12);
    expect(data.monthly[0]).toMatchObject({
      label: "Janvier",
      ordersCount: 1,
      totalTtc: 30,
      terroirCommission: 1.8,
      producerNet: 28.2,
    });
    expect(data.monthly[1]).toMatchObject({
      label: "Février",
      ordersCount: 1,
      totalTtc: 70,
      producerNet: 65.8,
    });
    expect(data.summary.bestMonth?.label).toBe("Février");
    expect(data.summary.averageBasket).toBe(50);
    expect(data.summary.uniqueClients).toBe(2);

    expect(capture.filters).toContainEqual(["producers", "user_id", "user-1"]);
    expect(capture.filters).toContainEqual([
      "orders",
      "producer_id",
      "producer-1",
    ]);
    expect(capture.inFilters).toContainEqual([
      "order_items",
      "order_id",
      ["order-jan", "order-feb"],
    ]);
  });

  it("classe les top produits par chiffre d'affaires", async () => {
    const data = await buildProducerAnnualReportData({
      admin: makeAdmin({
        producer: { data: producer, error: null },
        orders: {
          data: [
            {
              id: "order-1",
              completed_at: "2026-03-01T10:00:00.000Z",
              statut: "completed",
              montant_total: 100,
              commission_terroir: 6,
              montant_net_producteur: 94,
              producer_order_seq: 1,
              consumer_id: "consumer-1",
              consumer: { email: "a@example.fr" },
            },
            {
              id: "order-2",
              completed_at: "2026-03-05T10:00:00.000Z",
              statut: "completed",
              montant_total: 40,
              commission_terroir: 2.4,
              montant_net_producteur: 37.6,
              producer_order_seq: 2,
              consumer_id: "consumer-1",
              consumer: { email: "a@example.fr" },
            },
          ],
          error: null,
        },
        orderItems: {
          data: [
            {
              order_id: "order-1",
              product_id: "product-a",
              quantite: 2,
              sous_total: 60,
              product: { nom: "Colis découverte" },
            },
            {
              order_id: "order-1",
              product_id: "product-b",
              quantite: 1,
              sous_total: 40,
              product: { nom: "Steaks hachés" },
            },
            {
              order_id: "order-2",
              product_id: "product-b",
              quantite: 1,
              sous_total: 40,
              product: { nom: "Steaks hachés" },
            },
          ],
          error: null,
        },
      }),
      userId: "user-1",
      year: 2026,
    });

    expect(data.topProducts).toEqual([
      {
        productId: "product-b",
        name: "Steaks hachés",
        quantity: 2,
        totalTtc: 80,
        ordersCount: 2,
      },
      {
        productId: "product-a",
        name: "Colis découverte",
        quantity: 2,
        totalTtc: 60,
        ordersCount: 1,
      },
    ]);
  });

  it("génère un bilan vide sans chercher de produits", async () => {
    const capture: Capture = { filters: [], ranges: [], inFilters: [] };

    const data = await buildProducerAnnualReportData({
      admin: makeAdmin({
        producer: { data: producer, error: null },
        orders: { data: [], error: null },
        capture,
      }),
      userId: "user-1",
      year: 2025,
    });

    expect(data.summary).toMatchObject({
      ordersCount: 0,
      totalTtc: 0,
      terroirCommission: 0,
      producerNet: 0,
      averageBasket: 0,
      bestMonth: null,
      uniqueClients: 0,
    });
    expect(data.topProducts).toEqual([]);
    expect(capture.inFilters).toEqual([]);
  });
});

describe("annualReportPeriod", () => {
  it("retourne les bornes exactes de l'année", () => {
    expect(annualReportPeriod(2026)).toEqual({
      from: "2026-01-01",
      to: "2026-12-31",
    });
  });
});
