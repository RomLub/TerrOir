import { describe, expect, it } from "vitest";
import { generateProducerAnnualReportPdf } from "@/lib/accounting/producer-annual-report-pdf";
import type { ProducerAnnualReportData } from "@/lib/accounting/producer-annual-report";

function makeAnnualData(): ProducerAnnualReportData {
  return {
    generatedAt: "2026-05-28T12:00:00.000Z",
    year: 2026,
    period: {
      from: "2026-01-01",
      to: "2026-12-31",
      fromIso: "2025-12-31T23:00:00.000Z",
      toEndOfDayIso: "2026-12-31T22:59:59.999Z",
      label: "01/01/2026 - 31/12/2026",
    },
    producer: {
      id: "producer-1",
      name: "Romain Martin",
      exploitation: "Ferme du Pré",
      siret: "12345678901234",
      producerNumber: 42,
    },
    summary: {
      ordersCount: 0,
      totalTtc: 0,
      terroirCommission: 0,
      producerNet: 0,
      averageBasket: 0,
      bestMonth: null,
      uniqueClients: 0,
    },
    monthly: Array.from({ length: 12 }, (_, index) => ({
      month: index + 1,
      label: `Mois ${index + 1}`,
      ordersCount: 0,
      totalTtc: 0,
      terroirCommission: 0,
      producerNet: 0,
    })),
    topProducts: [],
  };
}

describe("generateProducerAnnualReportPdf", () => {
  it("génère un PDF même sans données annuelles", async () => {
    const pdf = await generateProducerAnnualReportPdf(makeAnnualData());

    expect(pdf.subarray(0, 5).toString("utf-8")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(4_000);
  });
});
