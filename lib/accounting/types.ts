import type { ParsedPeriod } from "@/lib/exports/period";

export type AccountingExportPeriodKey =
  | "current-month"
  | "previous-month"
  | "current-quarter"
  | "previous-quarter"
  | "current-year"
  | "previous-year"
  | "custom";

export type AccountingExportPeriod = {
  key: AccountingExportPeriodKey;
  label: string;
  from: string;
  to: string;
  parsed: ParsedPeriod;
};

export type ProducerAccountingOrderStatus =
  | "confirmed"
  | "completed"
  | "cancelled"
  | "refunded";

export type ProducerAccountingExportRow = {
  orderId: string;
  orderNumber: string;
  orderDate: string;
  clientName: string;
  status: ProducerAccountingOrderStatus;
  statusLabel: string;
  grossAmount: number;
  commissionAmount: number;
  producerNetAmount: number;
  paymentMethod: string;
  pickupOrValidationDate: string;
};

export type ProducerAccountingExportSummary = {
  orderCount: number;
  grossRevenue: number;
  terroirCommission: number;
  producerNet: number;
  cancelledOrRefundedCount: number;
};

export type ProducerAccountingExportData = {
  period: AccountingExportPeriod;
  summary: ProducerAccountingExportSummary;
  rows: ProducerAccountingExportRow[];
};
