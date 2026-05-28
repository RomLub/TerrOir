'use client';

import { useEffect, useState } from 'react';
import { Button, Input, PageHeader } from '@/components/ui';

type Summary = {
  ordersCount: number;
  totalTtc: number;
  terroirCommission: number;
  producerNet: number;
};

type SummaryState =
  | { status: 'loading'; data: null; error: null }
  | { status: 'ready'; data: Summary; error: null }
  | { status: 'error'; data: null; error: string };

function defaultRange() {
  const now = new Date();
  const year = now.getFullYear();
  return {
    from: `${year}-01-01`,
    to: now.toISOString().slice(0, 10),
  };
}

function formatEuro(value: number) {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
  }).format(value);
}

export default function ComptabilitePage() {
  const [{ from: initialFrom, to: initialTo }] = useState(defaultRange);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [downloading, setDownloading] = useState<'csv' | 'pdf' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryState>({
    status: 'loading',
    data: null,
    error: null,
  });

  useEffect(() => {
    if (!from || !to) return;

    const controller = new AbortController();
    setSummary({ status: 'loading', data: null, error: null });

    fetch(
      `/api/exports/producer/comptabilite/summary?from=${encodeURIComponent(
        from,
      )}&to=${encodeURIComponent(to)}`,
      { credentials: 'same-origin', signal: controller.signal },
    )
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        return res.json() as Promise<{ summary: Summary }>;
      })
      .then((data) => {
        setSummary({ status: 'ready', data: data.summary, error: null });
      })
      .catch((err: unknown) => {
        if ((err as Error).name === 'AbortError') return;
        setSummary({
          status: 'error',
          data: null,
          error: (err as Error).message ?? 'Synthèse indisponible',
        });
      });

    return () => controller.abort();
  }, [from, to]);

  const handleDownload = async (format: 'csv' | 'pdf') => {
    setError(null);
    setDownloading(format);
    try {
      const res = await fetch(
        `/api/exports/producer/comptabilite.${format}?from=${encodeURIComponent(
          from,
        )}&to=${encodeURIComponent(to)}`,
        { credentials: 'same-origin' },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `comptabilite_producer_${from}_${to}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      setError((err as Error).message ?? 'Téléchargement impossible');
    } finally {
      setDownloading(null);
    }
  };

  const disabled = Boolean(downloading || !from || !to);

  return (
    <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
      <PageHeader
        tone="producer"
        eyebrow="Comptabilité"
        title="Export comptable"
        subtitle="Télécharge l'historique de tes commandes validées sur la période choisie."
      />

      <section className="rounded-lg border border-dark/[0.06] bg-white p-5 shadow-soft sm:p-6">
        <h2 className="mb-4 font-serif text-[22px] text-green-900">
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
              summary.status === 'ready'
                ? String(summary.data.ordersCount)
                : summary.status === 'loading'
                  ? '...'
                  : '—'
            }
          />
          <SummaryCard
            label="Chiffre d'affaires TTC"
            value={
              summary.status === 'ready' ? formatEuro(summary.data.totalTtc) : '—'
            }
          />
          <SummaryCard
            label="Commission TerrOir"
            value={
              summary.status === 'ready'
                ? formatEuro(summary.data.terroirCommission)
                : '—'
            }
          />
          <SummaryCard
            label="Net producteur"
            value={
              summary.status === 'ready'
                ? formatEuro(summary.data.producerNet)
                : '—'
            }
            strong
          />
        </div>

        {summary.status === 'error' && (
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
              onClick={() => handleDownload('csv')}
              disabled={disabled}
              className="w-full sm:w-auto"
            >
              {downloading === 'csv' ? 'Téléchargement...' : 'Télécharger CSV'}
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={() => handleDownload('pdf')}
              disabled={disabled}
              className="w-full sm:w-auto"
            >
              {downloading === 'pdf' ? 'Téléchargement...' : 'Télécharger le PDF'}
            </Button>
          </div>
        </div>
      </section>
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
          ? 'border-green-700/35 bg-green-50'
          : 'border-dark/[0.06] bg-terroir-background'
      }`}
    >
      <p
        className={`text-[11px] font-semibold uppercase ${
          strong ? 'text-green-900' : 'text-dark/55'
        }`}
      >
        {label}
      </p>
      <p
        className={`mt-2 break-words font-serif text-[24px] leading-tight tabular-nums ${
          strong ? 'text-green-900' : 'text-terra-700'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
