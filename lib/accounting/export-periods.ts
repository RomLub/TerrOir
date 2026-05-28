import { TZDate } from "@date-fns/tz";
import {
  EXPORT_TIMEZONE,
  parsePeriodParams,
} from "@/lib/exports/period";
import type {
  AccountingExportPeriod,
  AccountingExportPeriodKey,
} from "./types";

export const ACCOUNTING_PERIOD_OPTIONS: Array<{
  value: AccountingExportPeriodKey;
  label: string;
}> = [
  { value: "current-month", label: "Mois en cours" },
  { value: "previous-month", label: "Mois précédent" },
  { value: "current-quarter", label: "Trimestre en cours" },
  { value: "previous-quarter", label: "Trimestre précédent" },
  { value: "current-year", label: "Année en cours" },
  { value: "previous-year", label: "Année précédente" },
  { value: "custom", label: "Période personnalisée" },
];

const PERIOD_KEYS = new Set<AccountingExportPeriodKey>(
  ACCOUNTING_PERIOD_OPTIONS.map((option) => option.value),
);

type ResolveAccountingExportPeriodArgs = {
  period?: string | null;
  from?: string | null;
  to?: string | null;
  now?: Date;
};

export type ResolveAccountingExportPeriodResult =
  | { ok: true; period: AccountingExportPeriod }
  | { ok: false; error: string };

export function isAccountingExportPeriodKey(
  value: string | null | undefined,
): value is AccountingExportPeriodKey {
  return Boolean(value && PERIOD_KEYS.has(value as AccountingExportPeriodKey));
}

export function resolveAccountingExportPeriod({
  period,
  from,
  to,
  now = new Date(),
}: ResolveAccountingExportPeriodArgs): ResolveAccountingExportPeriodResult {
  const key = isAccountingExportPeriodKey(period) ? period : "current-month";
  const range =
    key === "custom"
      ? from && to
        ? { from, to }
        : null
      : resolvePresetRange(key, now);

  if (!range) {
    return {
      ok: false,
      error: "Choisis une date de début et une date de fin.",
    };
  }

  const parsed = parsePeriodParams(range);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  return {
    ok: true,
    period: {
      key,
      from: range.from,
      to: range.to,
      label: buildPeriodLabel(key, range.from, range.to),
      parsed: parsed.period,
    },
  };
}

export function getDefaultAccountingExportPeriod(
  now = new Date(),
): AccountingExportPeriod {
  const result = resolveAccountingExportPeriod({
    period: "current-month",
    now,
  });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.period;
}

function resolvePresetRange(
  key: Exclude<AccountingExportPeriodKey, "custom">,
  now: Date,
): { from: string; to: string } {
  const localNow = new TZDate(now, EXPORT_TIMEZONE);
  const year = localNow.getFullYear();
  const month = localNow.getMonth() + 1;
  const today = toIsoDate(year, month, localNow.getDate());

  if (key === "current-month") {
    return { from: toIsoDate(year, month, 1), to: today };
  }

  if (key === "previous-month") {
    const previous = shiftMonth(year, month, -1);
    return {
      from: toIsoDate(previous.year, previous.month, 1),
      to: toIsoDate(
        previous.year,
        previous.month,
        daysInMonth(previous.year, previous.month),
      ),
    };
  }

  const quarter = Math.floor((month - 1) / 3) + 1;
  if (key === "current-quarter") {
    const startMonth = (quarter - 1) * 3 + 1;
    return { from: toIsoDate(year, startMonth, 1), to: today };
  }

  if (key === "previous-quarter") {
    const previousQuarter = quarter === 1 ? 4 : quarter - 1;
    const previousYear = quarter === 1 ? year - 1 : year;
    const startMonth = (previousQuarter - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    return {
      from: toIsoDate(previousYear, startMonth, 1),
      to: toIsoDate(previousYear, endMonth, daysInMonth(previousYear, endMonth)),
    };
  }

  if (key === "current-year") {
    return { from: toIsoDate(year, 1, 1), to: today };
  }

  return {
    from: toIsoDate(year - 1, 1, 1),
    to: toIsoDate(year - 1, 12, 31),
  };
}

function buildPeriodLabel(
  key: AccountingExportPeriodKey,
  from: string,
  to: string,
): string {
  const optionLabel =
    ACCOUNTING_PERIOD_OPTIONS.find((option) => option.value === key)?.label ??
    "Période";
  return `${optionLabel} · ${formatDateFr(from)} au ${formatDateFr(to)}`;
}

function shiftMonth(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const zeroBased = year * 12 + (month - 1) + delta;
  return {
    year: Math.floor(zeroBased / 12),
    month: (zeroBased % 12) + 1,
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
    2,
    "0",
  )}`;
}

function formatDateFr(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return date;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
