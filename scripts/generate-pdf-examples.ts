import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateProducerAnnualReportPdf } from "@/lib/accounting/producer-annual-report-pdf";
import { generateProducerAccountingPdf } from "@/lib/accounting/producer-export-pdf";
import type {
  ProducerAnnualReportData,
  ProducerAnnualReportMonth,
} from "@/lib/accounting/producer-annual-report";
import type {
  ProducerAccountingExportData,
  ProducerAccountingExportOrder,
} from "@/lib/accounting/producer-export-data";

const EXPORTS_DIR = join(process.cwd(), "exports");
const GENERATED_AT = "2026-05-28T12:00:00.000Z";
const YEAR = 2026;

const MONTH_LABELS = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
] as const;

const MONTHLY_TOTALS = [
  1250, 1980, 2420, 3100, 2890, 3380, 3650, 2920, 4100, 4720, 5960, 6282,
] as const;

async function main() {
  await mkdir(EXPORTS_DIR, { recursive: true });

  const accountingData = buildAccountingExampleData();
  const annualData = buildAnnualReportExampleData(accountingData);

  const accountingPath = join(
    EXPORTS_DIR,
    "comptabilite-terroir-exemple-2026.pdf",
  );
  const annualPath = join(EXPORTS_DIR, "bilan-annuel-terroir-exemple-2026.pdf");

  await writeFile(accountingPath, await generateProducerAccountingPdf(accountingData));
  await writeFile(annualPath, await generateProducerAnnualReportPdf(annualData));

  console.log(`PDF d'exemple générés :`);
  console.log(`- ${accountingPath}`);
  console.log(`- ${annualPath}`);
}

function buildAccountingExampleData(): ProducerAccountingExportData {
  const orders = buildOrders();

  return {
    generatedAt: GENERATED_AT,
    period: {
      from: `${YEAR}-01-01`,
      to: `${YEAR}-12-31`,
      fromIso: "2025-12-31T23:00:00.000Z",
      toEndOfDayIso: "2026-12-31T22:59:59.999Z",
      label: "01/01/2026 - 31/12/2026",
    },
    producer: {
      id: "producer-example",
      name: "Romain Martin",
      exploitation: "Ferme du Pré",
      siret: "12345678901234",
      producerNumber: 42,
    },
    summary: {
      ordersCount: orders.length,
      totalTtc: roundMoney(sumBy(orders, (order) => order.totalTtc)),
      terroirCommission: roundMoney(
        sumBy(orders, (order) => order.terroirCommission),
      ),
      producerNet: roundMoney(sumBy(orders, (order) => order.producerNet)),
    },
    orders,
  };
}

function buildAnnualReportExampleData(
  accounting: ProducerAccountingExportData,
): ProducerAnnualReportData {
  const monthly = buildMonthlyEvolution();
  const bestMonth = monthly[11] ?? null;

  return {
    ...accounting,
    year: YEAR,
    summary: {
      ordersCount: 186,
      totalTtc: 40652,
      terroirCommission: 2439.12,
      producerNet: 38212.88,
      averageBasket: 218.56,
      bestMonth,
      uniqueClients: 91,
    },
    monthly,
    topProducts: [
      {
        productId: "product-example-1",
        name: "Colis découverte boeuf 10 kg",
        quantity: 64,
        ordersCount: 41,
        totalTtc: 10440,
      },
      {
        productId: "product-example-2",
        name: "Entrecôte maturée",
        quantity: 38.5,
        ordersCount: 28,
        totalTtc: 4928,
      },
      {
        productId: "product-example-3",
        name: "Bourguignon prêt à cuisiner",
        quantity: 72,
        ordersCount: 34,
        totalTtc: 3744,
      },
      {
        productId: "product-example-4",
        name: "Steaks hachés fermiers",
        quantity: 95,
        ordersCount: 39,
        totalTtc: 3420,
      },
      {
        productId: "product-example-5",
        name: "Pot-au-feu",
        quantity: 48,
        ordersCount: 21,
        totalTtc: 2304,
      },
    ],
  };
}

function buildOrders(): ProducerAccountingExportOrder[] {
  return Array.from({ length: 28 }, (_, index) => {
    const orderIndex = index + 1;
    const totalTtc = roundMoney(85 + index * 3.5);
    const terroirCommission = roundMoney(totalTtc * 0.06);

    return {
      id: `order-example-${orderIndex}`,
      consumerId: `consumer-example-${(index % 12) + 1}`,
      orderNumber: `0042-${String(orderIndex).padStart(5, "0")}`,
      date: `${YEAR}-${String((index % 12) + 1).padStart(2, "0")}-${String(
        (index % 25) + 1,
      ).padStart(2, "0")}`,
      client: `c***${orderIndex}@e***.fr`,
      status: "Validée",
      totalTtc,
      terroirCommission,
      producerNet: roundMoney(totalTtc - terroirCommission),
      stripePayoutId: "po_example",
    };
  });
}

function buildMonthlyEvolution(): ProducerAnnualReportMonth[] {
  return MONTHLY_TOTALS.map((totalTtc, index) => {
    const terroirCommission = roundMoney(totalTtc * 0.06);

    return {
      month: index + 1,
      label: MONTH_LABELS[index],
      ordersCount: Math.round(totalTtc / 220),
      totalTtc,
      terroirCommission,
      producerNet: roundMoney(totalTtc - terroirCommission),
    };
  });
}

function sumBy<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((sum, row) => sum + pick(row), 0);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
