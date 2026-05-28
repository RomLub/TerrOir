import {
  formatPeriodForFilename,
} from "@/lib/exports/period";
import { serializeRowsToCsv } from "@/lib/exports/csv";
import type {
  AccountingExportPeriod,
  ProducerAccountingExportRow,
} from "./types";

export function buildProducerAccountingCsv(
  rows: ProducerAccountingExportRow[],
): string {
  const csvRows = rows.map((row) => ({
    date_commande: row.orderDate,
    numero_commande: row.orderNumber,
    client: row.clientName,
    statut: row.statusLabel,
    montant_ttc: formatEuros(row.grossAmount),
    commission_terroir: formatEuros(row.commissionAmount),
    montant_net_producteur: formatEuros(row.producerNetAmount),
    moyen_de_paiement: row.paymentMethod,
    date_retrait_ou_validation: row.pickupOrValidationDate,
  }));

  return serializeRowsToCsv(csvRows, [
    { key: "date_commande", header: "date commande" },
    { key: "numero_commande", header: "numero commande" },
    { key: "client", header: "client" },
    { key: "statut", header: "statut" },
    { key: "montant_ttc", header: "montant TTC" },
    { key: "commission_terroir", header: "commission TerrOir" },
    { key: "montant_net_producteur", header: "montant net producteur" },
    { key: "moyen_de_paiement", header: "moyen de paiement" },
    {
      key: "date_retrait_ou_validation",
      header: "date retrait ou validation",
    },
  ]);
}

export function buildProducerAccountingCsvFilename(
  period: AccountingExportPeriod,
): string {
  return `comptabilite_producteur_${formatPeriodForFilename({
    from: period.from,
    to: period.to,
  })}.csv`;
}

function formatEuros(value: number): string {
  return value.toFixed(2);
}
