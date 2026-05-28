import { describe, expect, it } from "vitest";
import { buildProducerAccountingCsv } from "@/lib/accounting/producer-export-csv";
import type { ProducerAccountingExportRow } from "@/lib/accounting/types";

describe("buildProducerAccountingCsv", () => {
  it("contient les colonnes attendues et les statuts explicites", () => {
    const rows: ProducerAccountingExportRow[] = [
      {
        orderId: "order-1",
        orderNumber: "0007-00042",
        orderDate: "2026-05-10",
        clientName: "Jeanne Martin",
        status: "refunded",
        statusLabel: "Remboursée",
        grossAmount: 30,
        commissionAmount: 1.8,
        producerNetAmount: 28.2,
        paymentMethod: "Carte bancaire",
        pickupOrValidationDate: "2026-05-12",
      },
    ];

    const csv = buildProducerAccountingCsv(rows);

    expect(csv).toContain(
      "date commande,numero commande,client,statut,montant TTC,commission TerrOir,montant net producteur,moyen de paiement,date retrait ou validation",
    );
    expect(csv).toContain("2026-05-10,0007-00042,Jeanne Martin");
    expect(csv).toContain("Remboursée");
    expect(csv).toContain("30.00,1.80,28.20,Carte bancaire,2026-05-12");
  });
});
