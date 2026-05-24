'use client';

import { useState } from 'react';
import { Button, Input, PageHeader } from '@/components/ui';

// Page comptabilité producer : sélecteur de période + bouton téléchargement
// CSV. Format CSV : séparateur ',', UTF-8 BOM, header 1ère ligne. Email
// consumer masqué (j***@d***.fr) — defense-in-depth RGPD pour transmission
// éventuelle vers comptable externe.

function defaultRange() {
  const now = new Date();
  const year = now.getFullYear();
  return {
    from: `${year}-01-01`,
    to: now.toISOString().slice(0, 10),
  };
}

export default function ComptabilitePage() {
  const [{ from: initialFrom, to: initialTo }] = useState(defaultRange);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async () => {
    setError(null);
    setDownloading(true);
    try {
      const res = await fetch(
        `/api/exports/producer/comptabilite.csv?from=${encodeURIComponent(
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
      a.download = `comptabilite_producer_${from}_${to}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      setError((err as Error).message ?? 'Téléchargement impossible');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-8 py-10">
      <PageHeader
        tone="producer"
        eyebrow="Comptabilité"
        title="Export comptable"
        subtitle="Télécharge l'historique de tes commandes validées sur la période choisie au format CSV."
      />

      <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
        <h2 className="font-serif text-[22px] text-green-900 mb-4">
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

        {error && (
          <p className="mt-3 text-[13px] text-terra-700" role="alert">
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-dark/[0.06] pt-4">
          <p className="text-[12px] text-dark/55 max-w-md">
            CSV &apos;,&apos; / UTF-8 BOM. Date filtrée = date de validation
            (completed_at). Email consumer masqué pour la confidentialité.
          </p>
          <Button
            variant="primary"
            size="md"
            onClick={handleDownload}
            disabled={downloading || !from || !to}
          >
            {downloading ? 'Téléchargement…' : 'Télécharger CSV'}
          </Button>
        </div>
      </section>
    </div>
  );
}
