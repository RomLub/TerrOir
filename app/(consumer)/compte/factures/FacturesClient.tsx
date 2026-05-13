"use client";

import { useState } from "react";
import { Button, Input } from "@/components/ui";

// Période par défaut : début de l'année courante → aujourd'hui (cas typique
// "ma compta de l'année en cours"). Le user peut affiner.
function defaultRange() {
  const now = new Date();
  const year = now.getFullYear();
  const from = `${year}-01-01`;
  const to = now.toISOString().slice(0, 10);
  return { from, to };
}

export function FacturesClient() {
  const [{ from: initialFrom, to: initialTo }] = useState(defaultRange);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const downloadUrl = `/api/exports/consumer/comptabilite.csv?from=${encodeURIComponent(
    from,
  )}&to=${encodeURIComponent(to)}`;

  const handleDownload = async () => {
    setError(null);
    setDownloading(true);
    try {
      const res = await fetch(downloadUrl, { credentials: "same-origin" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `comptabilite_${from}_${to}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      setError((err as Error).message ?? "Téléchargement impossible");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section className="mt-6 rounded-lg border border-terroir-border bg-white p-6">
      <h2 className="text-base font-semibold text-terroir-ink">
        Période d&rsquo;export
      </h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Input
          label="Du"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          max={to}
        />
        <Input
          label="Au"
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          min={from}
          max={new Date().toISOString().slice(0, 10)}
        />
      </div>
      {error && (
        <p className="mt-3 text-sm text-terroir-terracotta" role="alert">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-terroir-ink/60">
          Format CSV (séparateur virgule, encodage UTF-8). Compatible Excel,
          Google Sheets, Pandas, comptables.
        </p>
        <Button
          variant="primary"
          onClick={handleDownload}
          disabled={downloading || !from || !to}
        >
          {downloading ? "Téléchargement…" : "Télécharger CSV"}
        </Button>
      </div>
    </section>
  );
}
