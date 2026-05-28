import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDateInExportTimezone, parsePeriodParams } from "@/lib/exports/period";
import { maskEmailForExport } from "@/lib/exports/csv";
import { formatOrderNumber } from "@/lib/orders/order-number";
import type { Database } from "@/lib/types/database.types";

export type ProducerAccountingExportOrder = {
  id: string;
  consumerId?: string | null;
  orderNumber: string;
  date: string;
  client: string;
  status: string;
  totalTtc: number;
  terroirCommission: number;
  producerNet: number;
  stripePayoutId: string;
};

export type ProducerAccountingSummary = {
  ordersCount: number;
  totalTtc: number;
  terroirCommission: number;
  producerNet: number;
};

export type ProducerAccountingExportData = {
  generatedAt: string;
  period: {
    from: string;
    to: string;
    fromIso: string;
    toEndOfDayIso: string;
    label: string;
  };
  producer: {
    id: string;
    name: string;
    exploitation: string;
    siret: string | null;
    producerNumber: number;
  };
  summary: ProducerAccountingSummary;
  orders: ProducerAccountingExportOrder[];
};

type ProducerRow = {
  id: string;
  nom_exploitation: string | null;
  siret: string | null;
  producer_number: number | null;
  user:
    | { prenom: string | null; nom: string | null; email: string | null }
    | Array<{ prenom: string | null; nom: string | null; email: string | null }>
    | null;
};

type OrderRow = {
  id: string;
  completed_at: string | null;
  statut: string;
  montant_total: number | null;
  commission_terroir: number | null;
  montant_net_producteur: number | null;
  producer_order_seq: number | null;
  consumer_id: string | null;
  consumer: { email: string | null } | { email: string | null }[] | null;
};

type PayoutRow = {
  periode_debut: string;
  periode_fin: string;
  stripe_payout_id: string | null;
};

export class ProducerAccountingExportError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly dbError?: unknown,
    public readonly context?: Record<string, string | number | null | undefined>,
  ) {
    super(message);
    this.name = "ProducerAccountingExportError";
  }
}

export async function buildProducerAccountingExportData(args: {
  admin: SupabaseClient<Database>;
  userId: string;
  from: string | null;
  to: string | null;
  generatedAt?: Date;
}): Promise<ProducerAccountingExportData> {
  const periodResult = parsePeriodParams({ from: args.from, to: args.to });
  if (!periodResult.ok) {
    throw new ProducerAccountingExportError(periodResult.error, 400);
  }

  const { data: producerData, error: producerError } = await args.admin
    .from("producers")
    .select(
      "id, nom_exploitation, siret, producer_number, user:users!producers_user_id_fkey(prenom, nom, email)",
    )
    .eq("user_id", args.userId)
    .maybeSingle();

  if (producerError) {
    throw new ProducerAccountingExportError(
      producerError.message,
      500,
      "EXPORT_PRODUCER_LOOKUP_ERR",
      producerError,
      { user_id: args.userId },
    );
  }
  if (!producerData) {
    throw new ProducerAccountingExportError("Profil producteur introuvable", 403);
  }

  const producer = producerData as ProducerRow;
  const producerNumber = producer.producer_number ?? 0;

  const { data: ordersData, error: ordersError } = await args.admin
    .from("orders")
    .select(
      `id, completed_at, statut, montant_total, commission_terroir, montant_net_producteur,
       consumer_id,
       producer_order_seq, consumer:users!consumer_id(email)`,
    )
    .eq("producer_id", producer.id)
    .eq("statut", "completed")
    .gte("completed_at", periodResult.period.fromIso)
    .lte("completed_at", periodResult.period.toEndOfDayIso)
    .order("completed_at", { ascending: true })
    .limit(5000);

  if (ordersError) {
    throw new ProducerAccountingExportError(
      ordersError.message,
      500,
      "EXPORT_PRODUCER_COMPTA_ERR",
      ordersError,
      { producer_id: producer.id },
    );
  }

  const { data: payoutsData } = await args.admin
    .from("payouts")
    .select("id, periode_debut, periode_fin, stripe_payout_id")
    .eq("producer_id", producer.id)
    .gte("periode_fin", periodResult.period.fromIso.slice(0, 10))
    .lte("periode_debut", periodResult.period.toEndOfDayIso.slice(0, 10));

  const payouts = (payoutsData ?? []) as PayoutRow[];
  const orders = ((ordersData ?? []) as OrderRow[]).map((row) => {
    const consumer = Array.isArray(row.consumer) ? row.consumer[0] : row.consumer;
    const date = formatDateInExportTimezone(row.completed_at);
    return {
      id: row.id,
      consumerId: row.consumer_id,
      orderNumber: row.producer_order_seq
        ? formatOrderNumber(producerNumber, row.producer_order_seq)
        : row.id,
      date,
      client: maskEmailForExport(consumer?.email ?? null),
      status: formatOrderStatus(row.statut),
      totalTtc: normalizeAmount(row.montant_total),
      terroirCommission: normalizeAmount(row.commission_terroir),
      producerNet: normalizeAmount(row.montant_net_producteur),
      stripePayoutId: findPayoutForDate(date, payouts),
    };
  });

  const summary = summarizeOrders(orders);
  const exploitation = producer.nom_exploitation ?? "Exploitation";
  const user = Array.isArray(producer.user) ? producer.user[0] : producer.user;
  const producerName = [user?.prenom, user?.nom].filter(Boolean).join(" ").trim();

  return {
    generatedAt: (args.generatedAt ?? new Date()).toISOString(),
    period: {
      from: args.from ?? "",
      to: args.to ?? "",
      fromIso: periodResult.period.fromIso,
      toEndOfDayIso: periodResult.period.toEndOfDayIso,
      label: `${formatDisplayDate(args.from ?? "")} - ${formatDisplayDate(args.to ?? "")}`,
    },
    producer: {
      id: producer.id,
      name: producerName || exploitation,
      exploitation,
      siret: producer.siret,
      producerNumber,
    },
    summary,
    orders,
  };
}

function summarizeOrders(
  orders: ProducerAccountingExportOrder[],
): ProducerAccountingSummary {
  const cents = orders.reduce(
    (acc, order) => ({
      totalTtc: acc.totalTtc + toCents(order.totalTtc),
      terroirCommission:
        acc.terroirCommission + toCents(order.terroirCommission),
      producerNet: acc.producerNet + toCents(order.producerNet),
    }),
    { totalTtc: 0, terroirCommission: 0, producerNet: 0 },
  );
  return {
    ordersCount: orders.length,
    totalTtc: cents.totalTtc / 100,
    terroirCommission: cents.terroirCommission / 100,
    producerNet: cents.producerNet / 100,
  };
}

function findPayoutForDate(date: string, payouts: PayoutRow[]): string {
  if (!date) return "";
  const match = payouts.find(
    (payout) => payout.periode_debut <= date && payout.periode_fin >= date,
  );
  return match?.stripe_payout_id ?? "";
}

function formatOrderStatus(status: string): string {
  if (status === "completed") return "Validée";
  return status;
}

function normalizeAmount(value: number | null): number {
  return value ?? 0;
}

function toCents(value: number): number {
  return Math.round(value * 100);
}

function formatDisplayDate(value: string): string {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}
