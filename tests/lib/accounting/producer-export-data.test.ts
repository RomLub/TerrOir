import { describe, expect, it } from "vitest";
import {
  getProducerAccountingExportData,
  summarizeProducerAccountingRows,
} from "@/lib/accounting/producer-export-data";
import type {
  AccountingExportPeriod,
  ProducerAccountingExportRow,
} from "@/lib/accounting/types";

const period: AccountingExportPeriod = {
  key: "custom",
  label: "Test",
  from: "2026-05-01",
  to: "2026-05-31",
  parsed: {
    fromIso: "2026-04-30T22:00:00.000Z",
    toEndOfDayIso: "2026-05-31T21:59:59.999Z",
  },
};

describe("summarizeProducerAccountingRows", () => {
  it("additionne les ventes valides sans mélanger les annulations", () => {
    const rows: ProducerAccountingExportRow[] = [
      row({ status: "confirmed", grossAmount: 20, commissionAmount: 1.2, producerNetAmount: 18.8 }),
      row({ status: "completed", grossAmount: 30, commissionAmount: 1.8, producerNetAmount: 28.2 }),
      row({ status: "cancelled", grossAmount: 99, commissionAmount: 5.94, producerNetAmount: 93.06 }),
      row({ status: "refunded", grossAmount: 10, commissionAmount: 0.6, producerNetAmount: 9.4 }),
    ];

    expect(summarizeProducerAccountingRows(rows)).toEqual({
      orderCount: 4,
      grossRevenue: 50,
      terroirCommission: 3,
      producerNet: 47,
      cancelledOrRefundedCount: 2,
    });
  });
});

describe("getProducerAccountingExportData", () => {
  it("filtre toujours les commandes sur le producteur connecté", async () => {
    const captured: {
      filters: Array<[string, unknown]>;
      gte: Array<[string, unknown]>;
      lte: Array<[string, unknown]>;
      inFilters: Array<[string, unknown[]]>;
    } = { filters: [], gte: [], lte: [], inFilters: [] };

    const supabase = makeSupabaseMock(captured);

    const data = await getProducerAccountingExportData({
      supabase,
      userId: "user-42",
      period,
    });

    expect(data?.rows).toHaveLength(1);
    expect(captured.filters).toContainEqual(["user_id", "user-42"]);
    expect(captured.filters).toContainEqual(["producer_id", "producer-99"]);
    expect(captured.gte).toContainEqual(["created_at", period.parsed.fromIso]);
    expect(captured.lte).toContainEqual([
      "created_at",
      period.parsed.toEndOfDayIso,
    ]);
    expect(captured.inFilters).toContainEqual([
      "statut",
      ["confirmed", "completed", "cancelled", "refunded"],
    ]);
  });
});

function row(
  overrides: Partial<ProducerAccountingExportRow>,
): ProducerAccountingExportRow {
  return {
    orderId: "order",
    orderNumber: "0001-00001",
    orderDate: "2026-05-01",
    clientName: "Client",
    status: "confirmed",
    statusLabel: "Confirmée",
    grossAmount: 0,
    commissionAmount: 0,
    producerNetAmount: 0,
    paymentMethod: "",
    pickupOrValidationDate: "",
    ...overrides,
  };
}

function makeSupabaseMock(captured: {
  filters: Array<[string, unknown]>;
  gte: Array<[string, unknown]>;
  lte: Array<[string, unknown]>;
  inFilters: Array<[string, unknown[]]>;
}) {
  return {
    from: (table: string) => {
      const builder: any = {};
      builder.select = () => builder;
      builder.eq = (column: string, value: unknown) => {
        captured.filters.push([column, value]);
        return builder;
      };
      builder.gte = (column: string, value: unknown) => {
        captured.gte.push([column, value]);
        return builder;
      };
      builder.lte = (column: string, value: unknown) => {
        captured.lte.push([column, value]);
        return builder;
      };
      builder.in = (column: string, values: unknown[]) => {
        captured.inFilters.push([column, values]);
        return builder;
      };
      builder.order = () => builder;
      builder.limit = () => builder;
      builder.maybeSingle = () =>
        Promise.resolve({
          data: { id: "producer-99", producer_number: 7 },
          error: null,
        });
      builder.then = (resolve: (value: unknown) => unknown) => {
        if (table === "orders") {
          return Promise.resolve(
            resolve({
              data: [
                {
                  id: "order-1",
                  producer_order_seq: 42,
                  created_at: "2026-05-10T10:00:00.000Z",
                  statut: "confirmed",
                  montant_total: 25,
                  commission_terroir: 1.5,
                  montant_net_producteur: 23.5,
                  stripe_payment_intent_id: "pi_123",
                  date_retrait: "2026-05-12",
                  completed_at: null,
                  consumer: { prenom: "Jeanne", nom: "Martin" },
                },
              ],
              error: null,
            }),
          );
        }
        return Promise.resolve(resolve({ data: [], error: null }));
      };
      return builder;
    },
  } as any;
}
