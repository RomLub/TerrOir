import { describe, expect, it } from "vitest";
import { buildAnnualReportSummaryText } from "@/lib/accounting/pdf/annual-summary";
import type { ProducerAnnualReportData } from "@/lib/accounting/producer-annual-report";

function makeAnnualData(
  overrides: Partial<ProducerAnnualReportData["summary"]> = {},
): ProducerAnnualReportData {
  const bestMonth = {
    month: 12,
    label: "Décembre",
    ordersCount: 24,
    totalTtc: 6_240,
    terroirCommission: 374.4,
    producerNet: 5_865.6,
  };

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
      ordersCount: 186,
      totalTtc: 40_652,
      terroirCommission: 2_439.12,
      producerNet: 38_212.88,
      averageBasket: 218.56,
      bestMonth,
      uniqueClients: 91,
      ...overrides,
    },
    monthly: [],
    topProducts: [],
  };
}

describe("buildAnnualReportSummaryText", () => {
  it("génère une synthèse lisible depuis les chiffres annuels", () => {
    expect(buildAnnualReportSummaryText(makeAnnualData())).toEqual([
      "Votre activité TerrOir a généré 40 652,00 € de chiffre d'affaires en 2026.",
      "91 clients ont commandé vos produits.",
      "Décembre a été votre meilleur mois.",
    ]);
  });

  it("gère le cas d'une année sans commande", () => {
    expect(
      buildAnnualReportSummaryText(
        makeAnnualData({
          ordersCount: 0,
          totalTtc: 0,
          terroirCommission: 0,
          producerNet: 0,
          averageBasket: 0,
          bestMonth: null,
          uniqueClients: 0,
        }),
      ),
    ).toEqual([
      "Aucune commande validée n'a été enregistrée via TerrOir en 2026.",
      "Le bilan reste disponible pour conserver une trace annuelle claire.",
    ]);
  });
});
