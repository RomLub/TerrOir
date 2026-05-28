import { describe, expect, it } from "vitest";
import { generateProducerAccountingPdf } from "@/lib/accounting/producer-export-pdf";
import type { ProducerAccountingExportData } from "@/lib/accounting/producer-export-data";

function makeData(orderCount: number): ProducerAccountingExportData {
  const orders = Array.from({ length: orderCount }, (_, index) => {
    const n = index + 1;
    return {
      id: `order-${n}`,
      orderNumber: `0042-${String(n).padStart(5, "0")}`,
      date: "2026-05-07",
      client: `c***@e***.fr`,
      status: "Validée",
      totalTtc: 25,
      terroirCommission: 1.5,
      producerNet: 23.5,
      stripePayoutId: "po_123",
    };
  });

  return {
    generatedAt: "2026-05-28T12:00:00.000Z",
    period: {
      from: "2026-05-01",
      to: "2026-05-31",
      fromIso: "2026-04-30T22:00:00.000Z",
      toEndOfDayIso: "2026-05-31T21:59:59.999Z",
      label: "01/05/2026 - 31/05/2026",
    },
    producer: {
      id: "producer-1",
      name: "Romain Martin",
      exploitation: "Ferme du Pré",
      siret: "12345678901234",
      producerNumber: 42,
    },
    summary: {
      ordersCount: orderCount,
      totalTtc: orderCount * 25,
      terroirCommission: orderCount * 1.5,
      producerNet: orderCount * 23.5,
    },
    orders,
  };
}

describe("generateProducerAccountingPdf", () => {
  it("génère un PDF comptable avec peu de commandes", async () => {
    const pdf = await generateProducerAccountingPdf(makeData(1));

    expect(pdf.subarray(0, 5).toString("utf-8")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(4_000);
  });

  it("génère un PDF paginé avec beaucoup de commandes", async () => {
    const pdf = await generateProducerAccountingPdf(makeData(90));
    const content = pdf.toString("latin1");
    const pageObjects = content.match(/\/Type\s*\/Page\b/g) ?? [];

    expect(pdf.subarray(0, 5).toString("utf-8")).toBe("%PDF-");
    expect(pageObjects.length).toBeGreaterThan(1);
  });
});
