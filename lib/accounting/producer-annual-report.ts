import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildProducerAccountingExportData,
  ProducerAccountingExportError,
  type ProducerAccountingExportData,
  type ProducerAccountingExportOrder,
  type ProducerAccountingSummary,
} from "@/lib/accounting/producer-export-data";
import type { Database } from "@/lib/types/database.types";

export type ProducerAnnualReportMonth = {
  month: number;
  label: string;
  ordersCount: number;
  totalTtc: number;
  terroirCommission: number;
  producerNet: number;
};

export type ProducerAnnualReportProduct = {
  productId: string;
  name: string;
  quantity: number;
  totalTtc: number;
  ordersCount: number;
};

export type ProducerAnnualReportSummary = ProducerAccountingSummary & {
  averageBasket: number;
  bestMonth: ProducerAnnualReportMonth | null;
  uniqueClients: number;
};

export type ProducerAnnualReportData = {
  generatedAt: string;
  year: number;
  period: ProducerAccountingExportData["period"];
  producer: ProducerAccountingExportData["producer"];
  summary: ProducerAnnualReportSummary;
  monthly: ProducerAnnualReportMonth[];
  topProducts: ProducerAnnualReportProduct[];
};

type OrderItemRow = {
  order_id: string | null;
  product_id: string | null;
  quantite: number | null;
  sous_total: number | null;
  product: { nom: string | null } | Array<{ nom: string | null }> | null;
};

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

export function parseAnnualReportYear(raw: string | null): number {
  const year = raw ? Number(raw) : new Date().getFullYear();
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new ProducerAccountingExportError("Année invalide", 400);
  }
  return year;
}

export function annualReportPeriod(year: number): { from: string; to: string } {
  return {
    from: `${year}-01-01`,
    to: `${year}-12-31`,
  };
}

export async function buildProducerAnnualReportData(args: {
  admin: SupabaseClient<Database>;
  userId: string;
  year: number;
  generatedAt?: Date;
}): Promise<ProducerAnnualReportData> {
  const period = annualReportPeriod(args.year);
  const accounting = await buildProducerAccountingExportData({
    admin: args.admin,
    userId: args.userId,
    from: period.from,
    to: period.to,
    generatedAt: args.generatedAt,
  });

  const orderItems = await fetchOrderItemsForAnnualReport({
    admin: args.admin,
    orderIds: accounting.orders.map((order) => order.id),
  });

  return buildAnnualReportFromAccounting({
    accounting,
    year: args.year,
    orderItems,
  });
}

export function buildAnnualReportFromAccounting(args: {
  accounting: ProducerAccountingExportData;
  year: number;
  orderItems: OrderItemRow[];
}): ProducerAnnualReportData {
  const monthly = buildMonthlyEvolution(args.accounting.orders);
  const topProducts = buildTopProducts(args.orderItems);
  const bestMonth =
    monthly.reduce<ProducerAnnualReportMonth | null>((best, month) => {
      if (month.ordersCount === 0) return best;
      if (!best) return month;
      if (toCents(month.totalTtc) > toCents(best.totalTtc)) return month;
      if (
        toCents(month.totalTtc) === toCents(best.totalTtc) &&
        month.ordersCount > best.ordersCount
      ) {
        return month;
      }
      return best;
    }, null) ?? null;

  return {
    generatedAt: args.accounting.generatedAt,
    year: args.year,
    period: args.accounting.period,
    producer: args.accounting.producer,
    summary: {
      ...args.accounting.summary,
      averageBasket:
        args.accounting.summary.ordersCount === 0
          ? 0
          : roundMoney(
              args.accounting.summary.totalTtc /
                args.accounting.summary.ordersCount,
            ),
      bestMonth,
      uniqueClients: countUniqueClients(args.accounting.orders),
    },
    monthly,
    topProducts,
  };
}

export function producerAnnualReportFilename(year: number): string {
  return `bilan_annuel_terroir_${year}.pdf`;
}

async function fetchOrderItemsForAnnualReport(args: {
  admin: SupabaseClient<Database>;
  orderIds: string[];
}): Promise<OrderItemRow[]> {
  if (args.orderIds.length === 0) return [];

  const { data, error } = await args.admin
    .from("order_items")
    .select(
      "order_id, product_id, quantite, sous_total, product:products!order_items_product_id_fkey(nom)",
    )
    .in("order_id", args.orderIds)
    .limit(5000);

  if (error) {
    throw new ProducerAccountingExportError(
      error.message,
      500,
      "ANNUAL_REPORT_ORDER_ITEMS_ERR",
      error,
    );
  }

  return (data ?? []) as OrderItemRow[];
}

function buildMonthlyEvolution(
  orders: ProducerAccountingExportOrder[],
): ProducerAnnualReportMonth[] {
  const months = MONTH_LABELS.map((label, index) => ({
    month: index + 1,
    label,
    ordersCount: 0,
    totalTtcCents: 0,
    terroirCommissionCents: 0,
    producerNetCents: 0,
  }));

  for (const order of orders) {
    const monthIndex = Number(order.date.slice(5, 7)) - 1;
    if (monthIndex < 0 || monthIndex > 11) continue;
    const month = months[monthIndex];
    month.ordersCount += 1;
    month.totalTtcCents += toCents(order.totalTtc);
    month.terroirCommissionCents += toCents(order.terroirCommission);
    month.producerNetCents += toCents(order.producerNet);
  }

  return months.map((month) => ({
    month: month.month,
    label: month.label,
    ordersCount: month.ordersCount,
    totalTtc: month.totalTtcCents / 100,
    terroirCommission: month.terroirCommissionCents / 100,
    producerNet: month.producerNetCents / 100,
  }));
}

function buildTopProducts(
  rows: OrderItemRow[],
): ProducerAnnualReportProduct[] {
  const byProduct = new Map<
    string,
    { name: string; quantityCents: number; totalCents: number; orderIds: Set<string> }
  >();

  for (const row of rows) {
    const product = Array.isArray(row.product) ? row.product[0] : row.product;
    const productId = row.product_id ?? "produit-supprime";
    const current =
      byProduct.get(productId) ??
      {
        name: product?.nom ?? "Produit supprimé",
        quantityCents: 0,
        totalCents: 0,
        orderIds: new Set<string>(),
      };
    current.quantityCents += toCents(row.quantite ?? 0);
    current.totalCents += toCents(row.sous_total ?? 0);
    if (row.order_id) current.orderIds.add(row.order_id);
    byProduct.set(productId, current);
  }

  return [...byProduct.entries()]
    .map(([productId, product]) => ({
      productId,
      name: product.name,
      quantity: product.quantityCents / 100,
      totalTtc: product.totalCents / 100,
      ordersCount: product.orderIds.size,
    }))
    .sort((a, b) => {
      const totalDiff = toCents(b.totalTtc) - toCents(a.totalTtc);
      if (totalDiff !== 0) return totalDiff;
      return a.name.localeCompare(b.name, "fr");
    })
    .slice(0, 5);
}

function countUniqueClients(orders: ProducerAccountingExportOrder[]): number {
  const clients = new Set<string>();
  for (const order of orders) {
    if (order.consumerId) clients.add(order.consumerId);
  }
  return clients.size;
}

function roundMoney(value: number): number {
  return toCents(value) / 100;
}

function toCents(value: number): number {
  return Math.round(value * 100);
}
