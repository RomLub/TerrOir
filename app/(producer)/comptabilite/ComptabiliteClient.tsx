"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, type SelectOption } from "@/components/ui/select";
import type { ProducerAnnualReportData } from "@/lib/accounting/producer-annual-report";

type AnnualPreview = Pick<
  ProducerAnnualReportData,
  "year" | "summary" | "monthly" | "topProducts"
>;

type Summary = {
  ordersCount: number;
  totalTtc: number;
  terroirCommission: number;
  producerNet: number;
};

type SummaryState =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: Summary; error: null }
  | { status: "error"; data: null; error: string };

type AnnualState =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: AnnualPreview; error: null }
  | { status: "error"; data: null; error: string };

type DownloadKind = "csv" | "pdf" | "annual-pdf";

function defaultRange() {
  const now = new Date();
  const year = now.getFullYear();
  return {
    from: `${year}-01-01`,
    to: now.toISOString().slice(0, 10),
  };
}

function buildYearOptions(): SelectOption[] {
  const currentYear = new Date().getFullYear();
  return Array.from({ length: 7 }, (_, index) => {
    const year = currentYear - index;
    return { value: String(year), label: String(year) };
  });
}

function formatEuro(value: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 3,
  }).format(value);
}

export function ComptabiliteClient() {
  const [{ from: initialFrom, to: initialTo }] = useState(defaultRange);
  const [yearOptions] = useState(buildYearOptions);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [annualYear, setAnnualYear] = useState(yearOptions[0]?.value ?? "2026");
  const [downloading, setDownloading] = useState<DownloadKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [annualError, setAnnualError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryState>({
    status: "loading",
    data: null,
    error: null,
  });
  const [annual, setAnnual] = useState<AnnualState>({
    status: "loading",
    data: null,
    error: null,
  });

  useEffect(() => {
    if (!from || !to) return;

    const controller = new AbortController();
    setSummary({ status: "loading", data: null, error: null });

    fetch(
      `/api/exports/producer/comptabilite/summary?from=${encodeURIComponent(
        from,
      )}&to=${encodeURIComponent(to)}`,
      { credentials: "same-origin", signal: controller.signal },
    )
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        return res.json() as Promise<{ summary: Summary }>;
      })
      .then((data) => {
        setSummary({ status: "ready", data: data.summary, error: null });
      })
      .catch((err: unknown) => {
        if ((err as Error).name === "AbortError") return;
        setSummary({
          status: "error",
          data: null,
          error: (err as Error).message ?? "Synthèse indisponible",
        });
      });

    return () => controller.abort();
  }, [from, to]);

  useEffect(() => {
    if (!annualYear) return;

    const controller = new AbortController();
    setAnnual({ status: "loading", data: null, error: null });

    fetch(
      `/api/exports/producer/bilan-annuel/summary?year=${encodeURIComponent(
        annualYear,
      )}`,
      { credentials: "same-origin", signal: controller.signal },
    )
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        return res.json() as Promise<{ report: AnnualPreview }>;
      })
      .then((data) => {
        setAnnual({ status: "ready", data: data.report, error: null });
      })
      .catch((err: unknown) => {
        if ((err as Error).name === "AbortError") return;
        setAnnual({
          status: "error",
          data: null,
          error: (err as Error).message ?? "Bilan indisponible",
        });
      });

    return () => controller.abort();
  }, [annualYear]);

  const handleAccountingDownload = async (format: "csv" | "pdf") => {
    setError(null);
    setDownloading(format);
    try {
      const res = await fetch(
        `/api/exports/producer/comptabilite.${format}?from=${encodeURIComponent(
          from,
        )}&to=${encodeURIComponent(to)}`,
        { credentials: "same-origin" },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      await downloadResponse(res, `comptabilite_producer_${from}_${to}.${format}`);
    } catch (err) {
      setError((err as Error).message ?? "Téléchargement impossible");
    } finally {
      setDownloading(null);
    }
  };

  const handleAnnualDownload = async () => {
    setAnnualError(null);
    setDownloading("annual-pdf");
    try {
      const res = await fetch(
        `/api/exports/producer/bilan-annuel.pdf?year=${encodeURIComponent(
          annualYear,
        )}`,
        { credentials: "same-origin" },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      await downloadResponse(res, `bilan_annuel_terroir_${annualYear}.pdf`);
    } catch (err) {
      setAnnualError((err as Error).message ?? "Téléchargement impossible");
    } finally {
      setDownloading(null);
    }
  };

  const accountingDisabled = Boolean(downloading || !from || !to);
  const annualDisabled = Boolean(downloading || !annualYear);

  return (
    <div className="space-y-7">
      <section
        aria-labelledby="comptabilite-export-title"
        className="rounded-lg border border-dark/[0.06] bg-white p-5 shadow-soft sm:p-6"
      >
        <h2
          id="comptabilite-export-title"
          className="mb-4 font-serif text-[22px] text-green-900"
        >
          Période d&rsquo;export
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            id="comptabilite-from"
            label="Du"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            max={to}
          />
          <Input
            id="comptabilite-to"
            label="Au"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            min={from}
            max={new Date().toISOString().slice(0, 10)}
          />
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            label="Commandes"
            value={
              summary.status === "ready"
                ? String(summary.data.ordersCount)
                : summary.status === "loading"
                  ? "..."
                  : "—"
            }
          />
          <SummaryCard
            label="Chiffre d'affaires TTC"
            value={
              summary.status === "ready" ? formatEuro(summary.data.totalTtc) : "—"
            }
          />
          <SummaryCard
            label="Commission TerrOir"
            value={
              summary.status === "ready"
                ? formatEuro(summary.data.terroirCommission)
                : "—"
            }
          />
          <SummaryCard
            label="Net producteur"
            value={
              summary.status === "ready"
                ? formatEuro(summary.data.producerNet)
                : "—"
            }
            strong
          />
        </div>

        {summary.status === "error" && (
          <p className="mt-3 text-[13px] text-terra-700" role="alert">
            {summary.error}
          </p>
        )}

        {error && (
          <p className="mt-3 text-[13px] text-terra-700" role="alert">
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-col gap-3 border-t border-dark/[0.06] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xl text-[12px] leading-relaxed text-dark/55">
            Date filtrée = date de validation. Email client masqué dans les
            exports pour la confidentialité.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              variant="secondary"
              size="md"
              onClick={() => handleAccountingDownload("csv")}
              disabled={accountingDisabled}
              className="w-full sm:w-auto"
            >
              {downloading === "csv" ? "Téléchargement..." : "Télécharger CSV"}
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={() => handleAccountingDownload("pdf")}
              disabled={accountingDisabled}
              className="w-full sm:w-auto"
            >
              {downloading === "pdf"
                ? "Téléchargement..."
                : "Télécharger le PDF"}
            </Button>
          </div>
        </div>
      </section>

      <section
        aria-labelledby="bilan-annuel-title"
        className="rounded-lg border border-green-700/15 bg-white p-5 shadow-soft sm:p-6"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2
              id="bilan-annuel-title"
              className="font-serif text-[24px] leading-tight text-green-900"
            >
              Bilan annuel
            </h2>
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-dark/60">
              Synthèse d&rsquo;activité TerrOir, distincte de l&rsquo;export
              comptable.
            </p>
          </div>
          <div className="w-full sm:w-40">
            <Select
              id="bilan-annuel-year"
              label="Année"
              value={annualYear}
              onChange={(event) => setAnnualYear(event.target.value)}
              options={yearOptions}
            />
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            label="Commandes"
            value={
              annual.status === "ready"
                ? String(annual.data.summary.ordersCount)
                : annual.status === "loading"
                  ? "..."
                  : "—"
            }
          />
          <SummaryCard
            label="Chiffre d'affaires TTC"
            value={
              annual.status === "ready"
                ? formatEuro(annual.data.summary.totalTtc)
                : "—"
            }
          />
          <SummaryCard
            label="Net producteur"
            value={
              annual.status === "ready"
                ? formatEuro(annual.data.summary.producerNet)
                : "—"
            }
            strong
          />
          <SummaryCard
            label="Panier moyen"
            value={
              annual.status === "ready"
                ? formatEuro(annual.data.summary.averageBasket)
                : "—"
            }
          />
          <SummaryCard
            label="Commission TerrOir"
            value={
              annual.status === "ready"
                ? formatEuro(annual.data.summary.terroirCommission)
                : "—"
            }
          />
          <SummaryCard
            label="Meilleur mois"
            value={
              annual.status === "ready"
                ? (annual.data.summary.bestMonth?.label ?? "Aucun")
                : "—"
            }
          />
          <SummaryCard
            label="Clients uniques"
            value={
              annual.status === "ready"
                ? String(annual.data.summary.uniqueClients)
                : "—"
            }
          />
        </div>

        {annual.status === "ready" && (
          <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.65fr)]">
            <MonthlyPreview data={annual.data} />
            <TopProductsPreview data={annual.data} />
          </div>
        )}

        {annual.status === "error" && (
          <p className="mt-3 text-[13px] text-terra-700" role="alert">
            {annual.error}
          </p>
        )}

        {annualError && (
          <p className="mt-3 text-[13px] text-terra-700" role="alert">
            {annualError}
          </p>
        )}

        <div className="mt-6 flex flex-col gap-3 border-t border-dark/[0.06] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xl text-[12px] leading-relaxed text-dark/55">
            Le PDF indique qu&rsquo;il s&rsquo;agit d&rsquo;un bilan
            d&rsquo;activité non comptable.
          </p>
          <Button
            variant="success"
            size="md"
            onClick={handleAnnualDownload}
            disabled={annualDisabled}
            className="w-full sm:w-auto"
          >
            {downloading === "annual-pdf"
              ? "Téléchargement..."
              : "Télécharger le bilan annuel PDF"}
          </Button>
        </div>
      </section>
    </div>
  );
}

function MonthlyPreview({ data }: { data: AnnualPreview }) {
  const max = Math.max(...data.monthly.map((month) => month.totalTtc), 0);
  return (
    <div>
      <h3 className="text-[13px] font-semibold uppercase text-dark/60">
        Évolution mensuelle
      </h3>
      <div className="mt-3 space-y-2">
        {data.monthly.map((month) => (
          <div
            key={month.month}
            className="grid min-h-9 grid-cols-[74px_minmax(0,1fr)_92px] items-center gap-3 text-[12px]"
          >
            <span className="truncate font-medium text-dark/70">{month.label}</span>
            <span className="h-2 overflow-hidden rounded-full bg-terroir-background">
              <span
                className="block h-full rounded-full bg-green-700"
                style={{
                  width:
                    max > 0
                      ? `${Math.max(4, (month.totalTtc / max) * 100)}%`
                      : "0%",
                }}
              />
            </span>
            <span className="text-right font-medium tabular-nums text-green-900">
              {formatEuro(month.totalTtc)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TopProductsPreview({ data }: { data: AnnualPreview }) {
  return (
    <div>
      <h3 className="text-[13px] font-semibold uppercase text-dark/60">
        Top produits
      </h3>
      <div className="mt-3 space-y-2">
        {data.topProducts.length === 0 ? (
          <p className="rounded-md border border-dark/[0.06] bg-terroir-background p-3 text-[13px] text-dark/60">
            Aucun produit vendu sur cette année.
          </p>
        ) : (
          data.topProducts.slice(0, 3).map((product, index) => (
            <div
              key={product.productId}
              className="rounded-md border border-dark/[0.06] bg-terroir-background p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 text-[13px] font-semibold text-green-900">
                  <span className="mr-2 text-terra-700">#{index + 1}</span>
                  <span className="break-words">{product.name}</span>
                </p>
                <p className="shrink-0 text-[13px] font-semibold tabular-nums text-terra-700">
                  {formatEuro(product.totalTtc)}
                </p>
              </div>
              <p className="mt-1 text-[12px] text-dark/55">
                {formatQuantity(product.quantity)} vendu · {product.ordersCount}{" "}
                commandes
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      className={`min-h-[86px] rounded-lg border p-4 ${
        strong
          ? "border-green-700/35 bg-green-50"
          : "border-dark/[0.06] bg-terroir-background"
      }`}
    >
      <p
        className={`text-[11px] font-semibold uppercase ${
          strong ? "text-green-900" : "text-dark/55"
        }`}
      >
        {label}
      </p>
      <p
        className={`mt-2 break-words font-serif text-[24px] leading-tight tabular-nums ${
          strong ? "text-green-900" : "text-terra-700"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

async function downloadResponse(res: Response, fallbackFilename: string) {
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filenameFromDisposition(res.headers) ?? fallbackFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);
}

function filenameFromDisposition(headers: Headers): string | null {
  const disposition = headers.get("content-disposition");
  if (!disposition) return null;
  const match = /filename="([^"]+)"/.exec(disposition);
  return match?.[1] ?? null;
}
