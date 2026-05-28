import type { ProducerAnnualReportData } from "@/lib/accounting/producer-annual-report";
import { formatPdfEuro } from "@/lib/accounting/pdf/theme";

export function buildAnnualReportSummaryText(
  data: ProducerAnnualReportData,
): string[] {
  if (data.summary.ordersCount === 0) {
    return [
      `Aucune commande validée n'a été enregistrée via TerrOir en ${data.year}.`,
      "Le bilan reste disponible pour conserver une trace annuelle claire.",
    ];
  }

  const clientLabel =
    data.summary.uniqueClients > 1 ? "clients ont commandé" : "client a commandé";
  const bestMonthLabel = data.summary.bestMonth
    ? `${data.summary.bestMonth.label} a été votre meilleur mois.`
    : "Aucun meilleur mois ne se détache sur cette année.";

  return [
    `Votre activité TerrOir a généré ${formatPdfEuro(
      data.summary.totalTtc,
    )} de chiffre d'affaires en ${data.year}.`,
    `${data.summary.uniqueClients} ${clientLabel} vos produits.`,
    bestMonthLabel,
  ];
}
