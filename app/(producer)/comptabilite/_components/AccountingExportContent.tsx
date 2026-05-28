import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MetricCard } from "@/components/ui/metric-card";
import { OrderStatusBadge } from "@/components/ui/order-status-badge";
import { PageHeader } from "@/components/ui/page-header";
import type { ProducerAccountingExportData } from "@/lib/accounting/types";
import { AccountingPeriodControls } from "./AccountingPeriodControls";

type AccountingExportContentProps = {
  data: ProducerAccountingExportData;
  periodError?: string | null;
};

export function AccountingExportContent({
  data,
  periodError,
}: AccountingExportContentProps) {
  const previewRows = data.rows.slice(0, 12);

  return (
    <div className="mx-auto max-w-6xl px-8 py-10">
      <PageHeader
        tone="producer"
        eyebrow="Comptabilité"
        title="Export comptable"
        subtitle="Préparez les données de commandes à transmettre à votre comptable."
        error={periodError ?? undefined}
      />

      <Card className="p-6 md:p-8">
        <div className="mb-5">
          <h2 className="font-serif text-[24px] text-green-900">
            Choisir la période
          </h2>
          <p className="mt-1 text-[13px] text-dark/60">
            La synthèse et le CSV utilisent exactement la même période.
          </p>
        </div>
        <AccountingPeriodControls
          periodKey={data.period.key}
          from={data.period.from}
          to={data.period.to}
        />
      </Card>

      <section className="mt-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-serif text-[24px] text-green-900">
              Synthèse avant export
            </h2>
            <p className="mt-1 text-[13px] text-dark/60">
              {data.period.label}
            </p>
          </div>
          <DownloadCsvForm data={data} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Commandes"
            value={data.summary.orderCount}
            hint="hors commandes en attente"
          />
          <MetricCard
            label="Chiffre d'affaires TTC"
            value={formatEuro(data.summary.grossRevenue)}
            hint="commandes confirmées ou retirées"
          />
          <MetricCard
            label="Commission TerrOir"
            value={formatEuro(data.summary.terroirCommission)}
            hint="commandes confirmées ou retirées"
          />
          <MetricCard
            label="Net producteur"
            value={formatEuro(data.summary.producerNet)}
            hint="montant reversé estimé"
          />
        </div>

        {data.summary.cancelledOrRefundedCount > 0 ? (
          <div className="mt-4">
            <Badge tone="danger">
              {data.summary.cancelledOrRefundedCount} commande
              {data.summary.cancelledOrRefundedCount > 1 ? "s" : ""} annulée
              {data.summary.cancelledOrRefundedCount > 1 ? "s" : ""} ou
              remboursée
              {data.summary.cancelledOrRefundedCount > 1 ? "s" : ""}
            </Badge>
          </div>
        ) : null}
      </section>

      <Card className="mt-8 overflow-hidden">
        <div className="border-b border-dark/[0.06] p-6">
          <h2 className="font-serif text-[24px] text-green-900">
            Commandes incluses
          </h2>
        </div>

        {data.rows.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <h3 className="font-serif text-[22px] text-green-900">
              Aucune commande sur cette période
            </h3>
            <p className="mt-2 text-[14px] text-dark/60">
              Changez la période pour préparer un export.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-bg text-[11px] uppercase tracking-widest text-dark/55">
                <tr>
                  <th className="px-6 py-3 text-left font-semibold">Date</th>
                  <th className="px-4 py-3 text-left font-semibold">
                    Commande
                  </th>
                  <th className="px-4 py-3 text-left font-semibold">Client</th>
                  <th className="px-4 py-3 text-left font-semibold">Statut</th>
                  <th className="px-4 py-3 text-right font-semibold">
                    Montant TTC
                  </th>
                  <th className="px-4 py-3 text-right font-semibold">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark/[0.06]">
                {previewRows.map((row) => (
                  <tr
                    key={row.orderId}
                    className="transition-colors hover:bg-green-100/20"
                  >
                    <td className="px-6 py-4 text-dark/70">
                      {row.orderDate}
                    </td>
                    <td className="px-4 py-4 font-medium text-dark">
                      {row.orderNumber}
                    </td>
                    <td className="px-4 py-4 text-dark/70">
                      {row.clientName}
                    </td>
                    <td className="px-4 py-4">
                      <OrderStatusBadge status={row.status} />
                    </td>
                    <td className="px-4 py-4 text-right tabular-nums text-dark/70">
                      {formatEuro(row.grossAmount)}
                    </td>
                    <td className="px-4 py-4 text-right font-serif text-[16px] tabular-nums text-green-900">
                      {formatEuro(row.producerNetAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.rows.length > previewRows.length ? (
              <p className="border-t border-dark/[0.06] px-6 py-4 text-[13px] text-dark/60">
                Le CSV contiendra les {data.rows.length} commandes de la
                période.
              </p>
            ) : null}
          </div>
        )}
      </Card>
    </div>
  );
}

function DownloadCsvForm({ data }: { data: ProducerAccountingExportData }) {
  return (
    <form action="/api/exports/producer/comptabilite.csv" method="get">
      <input type="hidden" name="period" value="custom" />
      <input type="hidden" name="from" value={data.period.from} />
      <input type="hidden" name="to" value={data.period.to} />
      <Button type="submit" variant="primary" disabled={data.rows.length === 0}>
        Télécharger le CSV
      </Button>
    </form>
  );
}

function formatEuro(value: number): string {
  return `${value.toFixed(2).replace(".", ",")} €`;
}
