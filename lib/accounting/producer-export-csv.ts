import { formatPeriodForFilename } from "@/lib/exports/period";
import { serializeRowsToCsv } from "@/lib/exports/csv";
import type { ProducerAccountingExportData } from "@/lib/accounting/producer-export-data";

export function buildProducerAccountingCsv(data: ProducerAccountingExportData): string {
  const rows = data.orders.map((order) => ({
    commande_id: order.id,
    date_validation: order.date,
    consumer_email_masked: order.client,
    montant_produits: formatEuros(order.producerNet),
    commission_terroir_6pct: formatEuros(order.terroirCommission),
    payout_net: formatEuros(order.producerNet),
    stripe_payout_id: order.stripePayoutId,
  }));

  return serializeRowsToCsv(rows, [
    { key: "commande_id", header: "commande_id" },
    { key: "date_validation", header: "date_validation" },
    { key: "consumer_email_masked", header: "consumer_email_masked" },
    { key: "montant_produits", header: "montant_produits" },
    { key: "commission_terroir_6pct", header: "commission_terroir_6%" },
    { key: "payout_net", header: "payout_net" },
    { key: "stripe_payout_id", header: "stripe_payout_id" },
  ]);
}

export function producerAccountingFilename(args: {
  from: string;
  to: string;
  extension: "csv" | "pdf";
}): string {
  return `comptabilite_producer_${formatPeriodForFilename(args)}.${args.extension}`;
}

function formatEuros(value: number): string {
  return value.toFixed(2);
}
