import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildProducerAccountingExportData,
  ProducerAccountingExportError,
} from "@/lib/accounting/producer-export-data";
import type { Database } from "@/lib/types/database.types";

type DbResponse = {
  data: unknown;
  error: { message: string } | null;
};

type Capture = {
  filters: Array<[string, string, unknown]>;
  ranges: Array<[string, string, unknown]>;
};

function makeAdmin(args: {
  producer: DbResponse;
  orders: DbResponse;
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
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => Promise.resolve(args.producer),
        then: (resolve: (value: DbResponse) => unknown) => {
          if (table === "orders") return Promise.resolve(resolve(args.orders));
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

describe("buildProducerAccountingExportData", () => {
  it("calcule les totaux, la période et les lignes PDF depuis les commandes du producteur", async () => {
    const capture: Capture = { filters: [], ranges: [] };
    const data = await buildProducerAccountingExportData({
      admin: makeAdmin({
        producer: { data: producer, error: null },
        orders: {
          data: [
            {
              id: "order-1",
              completed_at: "2026-05-07T10:00:00.000Z",
              statut: "completed",
              montant_total: 10,
              commission_terroir: 0.6,
              montant_net_producteur: 9.4,
              producer_order_seq: 1,
              consumer: { email: "julien@example.fr" },
            },
            {
              id: "order-2",
              completed_at: "2026-05-08T10:00:00.000Z",
              statut: "completed",
              montant_total: 20,
              commission_terroir: 1.2,
              montant_net_producteur: 18.8,
              producer_order_seq: 2,
              consumer: { email: "camille@example.fr" },
            },
          ],
          error: null,
        },
        payouts: {
          data: [
            {
              periode_debut: "2026-05-05",
              periode_fin: "2026-05-11",
              stripe_payout_id: "po_123",
            },
          ],
          error: null,
        },
        capture,
      }),
      userId: "user-1",
      from: "2026-05-01",
      to: "2026-05-31",
      generatedAt: new Date("2026-05-28T12:00:00.000Z"),
    });

    expect(data.period.label).toBe("01/05/2026 - 31/05/2026");
    expect(data.producer.name).toBe("Romain Martin");
    expect(data.producer.exploitation).toBe("Ferme du Pré");
    expect(data.producer.siret).toBe("12345678901234");
    expect(data.summary).toEqual({
      ordersCount: 2,
      totalTtc: 30,
      terroirCommission: 1.8,
      producerNet: 28.2,
    });
    expect(data.orders[0]).toMatchObject({
      orderNumber: "0042-00001",
      client: "j***@e***.fr",
      status: "Validée",
      stripePayoutId: "po_123",
    });

    expect(capture.filters).toContainEqual(["producers", "user_id", "user-1"]);
    expect(capture.filters).toContainEqual([
      "orders",
      "producer_id",
      "producer-1",
    ]);
    expect(capture.filters).toContainEqual(["orders", "statut", "completed"]);
    expect(capture.ranges.some(([table, column]) => table === "orders" && column === "completed_at")).toBe(true);
  });

  it("génère un document vide mais valide quand aucune commande ne correspond", async () => {
    const data = await buildProducerAccountingExportData({
      admin: makeAdmin({
        producer: { data: producer, error: null },
        orders: { data: [], error: null },
      }),
      userId: "user-1",
      from: "2026-01-01",
      to: "2026-01-31",
      generatedAt: new Date("2026-05-28T12:00:00.000Z"),
    });

    expect(data.orders).toEqual([]);
    expect(data.summary).toEqual({
      ordersCount: 0,
      totalTtc: 0,
      terroirCommission: 0,
      producerNet: 0,
    });
  });

  it("bloque un utilisateur sans fiche producteur", async () => {
    await expect(
      buildProducerAccountingExportData({
        admin: makeAdmin({
          producer: { data: null, error: null },
          orders: { data: [], error: null },
        }),
        userId: "consumer-1",
        from: "2026-01-01",
        to: "2026-01-31",
      }),
    ).rejects.toMatchObject({
      status: 403,
      message: "Profil producteur introuvable",
    } satisfies Partial<ProducerAccountingExportError>);
  });
});
