import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatDateInExportTimezone } from "@/lib/exports/period";
import { formatOrderNumber } from "@/lib/orders/order-number";
import type {
  AccountingExportPeriod,
  ProducerAccountingExportData,
  ProducerAccountingExportRow,
  ProducerAccountingExportSummary,
  ProducerAccountingOrderStatus,
} from "./types";

export const PRODUCER_ACCOUNTING_EXPORT_STATUSES = [
  "confirmed",
  "completed",
  "cancelled",
  "refunded",
] as const satisfies readonly ProducerAccountingOrderStatus[];

const REVENUE_STATUSES = new Set<ProducerAccountingOrderStatus>([
  "confirmed",
  "completed",
]);

const STATUS_LABELS: Record<ProducerAccountingOrderStatus, string> = {
  confirmed: "Confirmée",
  completed: "Retirée",
  cancelled: "Annulée",
  refunded: "Remboursée",
};

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

type ProducerRow = {
  id: string;
  producer_number: number;
};

type RawOrderRow = {
  id: string;
  producer_order_seq: number;
  created_at: string | null;
  statut: string | null;
  montant_total: number | null;
  commission_terroir: number | null;
  montant_net_producteur: number | null;
  stripe_payment_intent_id: string | null;
  date_retrait: string | null;
  completed_at: string | null;
  consumer:
    | { prenom: string | null; nom: string | null }
    | Array<{ prenom: string | null; nom: string | null }>
    | null;
};

export async function getProducerAccountingExportData({
  supabase,
  userId,
  period,
}: {
  supabase: SupabaseAdminClient;
  userId: string;
  period: AccountingExportPeriod;
}): Promise<ProducerAccountingExportData | null> {
  const producer = await fetchProducerForAccountingExport(supabase, userId);
  if (!producer) return null;

  const rows = await fetchProducerAccountingRows({
    supabase,
    producer,
    period,
  });

  return {
    period,
    rows,
    summary: summarizeProducerAccountingRows(rows),
  };
}

export function summarizeProducerAccountingRows(
  rows: ProducerAccountingExportRow[],
): ProducerAccountingExportSummary {
  const revenueRows = rows.filter((row) => REVENUE_STATUSES.has(row.status));
  return {
    orderCount: rows.length,
    grossRevenue: sumMoney(revenueRows.map((row) => row.grossAmount)),
    terroirCommission: sumMoney(
      revenueRows.map((row) => row.commissionAmount),
    ),
    producerNet: sumMoney(revenueRows.map((row) => row.producerNetAmount)),
    cancelledOrRefundedCount: rows.filter(
      (row) => row.status === "cancelled" || row.status === "refunded",
    ).length,
  };
}

async function fetchProducerForAccountingExport(
  supabase: SupabaseAdminClient,
  userId: string,
): Promise<ProducerRow | null> {
  const { data, error } = await supabase
    .from("producers")
    .select("id, producer_number")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data as ProducerRow | null;
}

async function fetchProducerAccountingRows({
  supabase,
  producer,
  period,
}: {
  supabase: SupabaseAdminClient;
  producer: ProducerRow;
  period: AccountingExportPeriod;
}): Promise<ProducerAccountingExportRow[]> {
  const { data, error } = await supabase
    .from("orders")
    .select(
      `
        id,
        producer_order_seq,
        created_at,
        statut,
        montant_total,
        commission_terroir,
        montant_net_producteur,
        stripe_payment_intent_id,
        date_retrait,
        completed_at,
        consumer:users!orders_consumer_id_fkey(prenom, nom)
      `,
    )
    .eq("producer_id", producer.id)
    .gte("created_at", period.parsed.fromIso)
    .lte("created_at", period.parsed.toEndOfDayIso)
    .in("statut", [...PRODUCER_ACCOUNTING_EXPORT_STATUSES])
    .order("created_at", { ascending: true })
    .limit(5000);

  if (error) throw error;

  return ((data ?? []) as RawOrderRow[])
    .filter((order): order is RawOrderRow & { statut: ProducerAccountingOrderStatus } =>
      PRODUCER_ACCOUNTING_EXPORT_STATUSES.includes(
        order.statut as ProducerAccountingOrderStatus,
      ),
    )
    .map((order) => mapOrderToExportRow(order, producer.producer_number));
}

function mapOrderToExportRow(
  order: RawOrderRow & { statut: ProducerAccountingOrderStatus },
  producerNumber: number,
): ProducerAccountingExportRow {
  const consumer = Array.isArray(order.consumer)
    ? order.consumer[0]
    : order.consumer;
  const clientName = [consumer?.prenom, consumer?.nom]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");

  return {
    orderId: order.id,
    orderNumber: formatOrderNumber(
      producerNumber,
      order.producer_order_seq,
    ),
    orderDate: formatDateInExportTimezone(order.created_at),
    clientName: clientName || "Client",
    status: order.statut,
    statusLabel: STATUS_LABELS[order.statut],
    grossAmount: normalizeMoney(order.montant_total),
    commissionAmount: normalizeMoney(order.commission_terroir),
    producerNetAmount: normalizeMoney(order.montant_net_producteur),
    paymentMethod: order.stripe_payment_intent_id ? "Carte bancaire" : "",
    pickupOrValidationDate:
      formatDateInExportTimezone(order.completed_at) || order.date_retrait || "",
  };
}

function normalizeMoney(value: number | null): number {
  return Math.round(Number(value ?? 0) * 100) / 100;
}

function sumMoney(values: number[]): number {
  const cents = values.reduce(
    (sum, value) => sum + Math.round(Number(value) * 100),
    0,
  );
  return cents / 100;
}
