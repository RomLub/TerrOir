"use client";

import { useState, useTransition } from "react";
import {
  approvePendingRefund,
  denyPendingRefund,
} from "../_actions/decide";

type Row = {
  id: string;
  order_id: string;
  producer_id: string;
  amount_eur: number;
  reason: string | null;
  status: "pending" | "approved" | "denied" | "expired";
  requested_at: string;
  decided_at: string | null;
  decision_reason: string | null;
  order_code: string | null;
  producer_name: string | null;
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_LABELS: Record<Row["status"], string> = {
  pending: "En attente",
  approved: "Approuvé",
  denied: "Refusé",
  expired: "Expiré (7j)",
};

const STATUS_COLORS: Record<Row["status"], string> = {
  pending: "bg-yellow-100 text-yellow-800 border-yellow-300",
  approved: "bg-green-100 text-green-800 border-green-300",
  denied: "bg-red-100 text-red-800 border-red-300",
  expired: "bg-gray-100 text-gray-700 border-gray-300",
};

export function PendingRefundsClient({ rows }: { rows: Row[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handle = (
    id: string,
    decision: "approved" | "denied",
    decisionReason: string,
  ) => {
    setBusy(id);
    setError(null);
    const formData = new FormData();
    formData.set("pendingRefundId", id);
    if (decisionReason) formData.set("decisionReason", decisionReason);

    startTransition(async () => {
      const action =
        decision === "approved" ? approvePendingRefund : denyPendingRefund;
      const result = await action(formData);
      if (!result.ok) {
        setError(`Échec : ${result.reason}`);
      }
      setBusy(null);
    });
  };

  const pendingRows = rows.filter((r) => r.status === "pending");
  const decidedRows = rows.filter((r) => r.status !== "pending");

  return (
    <div className="px-6 pb-6 pt-4">
      <header className="mb-6">
        <h1 className="font-serif text-2xl text-gray-900">
          Demandes à arbitrer
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          Producteurs ayant demandé un remboursement au-delà du plafond.
          L&rsquo;approbation déclenche le remboursement Stripe immédiat.
        </p>
      </header>

      {error ? (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <section>
        <h2 className="mb-3 font-serif text-lg text-gray-900">
          En attente ({pendingRows.length})
        </h2>
        {pendingRows.length === 0 ? (
          <p className="text-sm text-gray-600">
            Aucune demande de refund en attente.
          </p>
        ) : (
          <div className="space-y-3">
            {pendingRows.map((r) => (
              <PendingRow
                key={r.id}
                row={r}
                busy={busy === r.id || pending}
                onDecide={handle}
              />
            ))}
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="mb-3 font-serif text-lg text-gray-900">
          Historique ({decidedRows.length})
        </h2>
        {decidedRows.length === 0 ? (
          <p className="text-sm text-gray-600">Pas encore d&rsquo;historique.</p>
        ) : (
          <div className="space-y-2">
            {decidedRows.map((r) => (
              <article
                key={r.id}
                className="rounded-md border border-gray-200 bg-white p-3 text-sm shadow-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_COLORS[r.status]}`}
                  >
                    {STATUS_LABELS[r.status]}
                  </span>
                  <span className="font-mono text-xs text-gray-700">
                    {r.order_code ?? r.order_id.slice(0, 8)}
                  </span>
                  <span className="text-gray-700">
                    {r.amount_eur.toFixed(2)}€
                  </span>
                  <span className="text-gray-600">
                    par {r.producer_name ?? r.producer_id.slice(0, 8)}
                  </span>
                  {r.decided_at ? (
                    <span className="text-xs text-gray-500">
                      · décidé le {formatDate(r.decided_at)}
                    </span>
                  ) : null}
                </div>
                {r.decision_reason ? (
                  <p className="mt-1 text-xs italic text-gray-600">
                    « {r.decision_reason} »
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function PendingRow({
  row,
  busy,
  onDecide,
}: {
  row: Row;
  busy: boolean;
  onDecide: (
    id: string,
    decision: "approved" | "denied",
    reason: string,
  ) => void;
}) {
  const [reasonText, setReasonText] = useState("");
  return (
    <article className="rounded-md border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-gray-700">
              {row.order_code ?? row.order_id.slice(0, 8)}
            </span>
            <span className="text-base font-semibold text-gray-900">
              {row.amount_eur.toFixed(2)}€
            </span>
            <span className="text-sm text-gray-600">
              par {row.producer_name ?? row.producer_id.slice(0, 8)}
            </span>
            <span className="text-xs text-gray-500">
              · demandé le {formatDate(row.requested_at)}
            </span>
          </div>
          {row.reason ? (
            <p className="mt-2 text-sm italic text-gray-700">
              « {row.reason} »
            </p>
          ) : (
            <p className="mt-2 text-xs italic text-gray-500">
              (Pas de motif fourni par le producteur)
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-2 border-t border-gray-200 pt-3">
        <textarea
          id={`reason-${row.id}`}
          name="decisionReason"
          rows={2}
          maxLength={1000}
          placeholder="Motif de la décision (optionnel)…"
          className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
          value={reasonText}
          onChange={(e) => setReasonText(e.target.value)}
          disabled={busy}
        />
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide(row.id, "denied", reasonText.trim())}
            className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Refuser
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide(row.id, "approved", reasonText.trim())}
            className="rounded-md bg-green-700 px-3 py-1.5 text-sm text-white hover:bg-green-800 disabled:opacity-50"
          >
            {busy ? "Traitement…" : "Approuver + refund"}
          </button>
        </div>
      </div>
    </article>
  );
}
