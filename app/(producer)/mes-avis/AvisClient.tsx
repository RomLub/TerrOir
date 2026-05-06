'use client';

import { useState, useMemo } from 'react';
import { StarRating, TableActionButton } from '@/components/ui';

export type AvisRow = {
  id: string;
  author: string;
  rating: number;
  comment: string;
  createdAt: string;
  publishedAt: string | null;
  response: string | null;
  responseAt: string | null;
  responseUpdatedAt: string | null;
  responseLockedAt: string | null;
  responseStatus: 'published' | 'removed_admin' | 'removed_producer' | null;
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatHoursLeft(lockedAtIso: string): string {
  const locked = new Date(lockedAtIso).getTime();
  const ms = locked - Date.now();
  if (ms <= 0) return 'Figée';
  const h = Math.floor(ms / (60 * 60 * 1000));
  const m = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  if (h === 0) return `Encore ${m} min pour modifier`;
  return `Encore ${h}h${m.toString().padStart(2, '0')} pour modifier`;
}

export function AvisClient({ initialRows }: { initialRows: AvisRow[] }) {
  const [rows, setRows] = useState<AvisRow[]>(initialRows);

  const stats = useMemo(() => {
    const total = rows.length;
    const responded = rows.filter((r) => r.response !== null).length;
    const avg =
      total > 0
        ? rows.reduce((s, r) => s + r.rating, 0) / total
        : 0;
    return { total, responded, avg };
  }, [rows]);

  return (
    <div className="p-6 md:p-8">
      <header className="mb-6">
        <h1 className="font-serif text-[28px] text-gray-900">Mes avis</h1>
        <p className="mt-1 text-[14px] text-gray-600">
          Vous pouvez répondre à chaque avis publié. Une réponse reste
          modifiable pendant 24h, puis devient figée.
        </p>
        <div className="mt-4 flex flex-wrap gap-4 text-[13px]">
          <span className="rounded-md bg-terroir-green-100 px-3 py-1.5 text-terroir-green-700 font-semibold">
            {stats.total} avis
          </span>
          <span className="rounded-md bg-terroir-bg px-3 py-1.5 text-gray-700">
            {stats.responded} avec réponse
          </span>
          {stats.total > 0 && (
            <span className="rounded-md bg-terroir-bg px-3 py-1.5 text-gray-700">
              Moyenne {stats.avg.toFixed(1)} / 5
            </span>
          )}
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-md border border-gray-200 bg-white p-8 text-center">
          <p className="text-[15px] text-gray-700">Aucun avis publié pour le moment.</p>
          <p className="mt-1 text-[13px] text-gray-500">
            Vos clients pourront laisser un avis après une commande terminée.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {rows.map((r) => (
            <ReviewCard
              key={r.id}
              row={r}
              onChange={(updated) =>
                setRows((arr) => arr.map((x) => (x.id === updated.id ? updated : x)))
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewCard({
  row,
  onChange,
}: {
  row: AvisRow;
  onChange: (updated: AvisRow) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(row.response ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLocked =
    row.responseLockedAt !== null &&
    new Date(row.responseLockedAt).getTime() <= Date.now();
  const hasResponse = row.response !== null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/producer/reviews/${row.id}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: text.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? 'Publication impossible');
        return;
      }
      const now = new Date().toISOString();
      onChange({
        ...row,
        response: text.trim(),
        responseAt: hasResponse ? row.responseAt : now,
        responseUpdatedAt: hasResponse ? now : null,
        responseLockedAt:
          hasResponse
            ? row.responseLockedAt
            : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        responseStatus: 'published',
      });
      setEditing(false);
    } catch {
      setError('Erreur de connexion');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm('Supprimer définitivement votre réponse ?')) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/producer/reviews/${row.id}/respond`, {
        method: 'DELETE',
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? 'Suppression impossible');
        return;
      }
      onChange({
        ...row,
        response: null,
        responseStatus: 'removed_producer',
      });
      setText('');
    } catch {
      setError('Erreur de connexion');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="rounded-md border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <StarRating value={row.rating} readOnly size="md" />
            <span className="font-serif text-[18px] text-gray-900">{row.author}</span>
            <span className="font-mono text-[12px] text-gray-500">
              {formatDate(row.publishedAt ?? row.createdAt)}
            </span>
          </div>
          {row.comment && (
            <p className="mt-3 text-[15px] italic leading-relaxed text-gray-700">
              « {row.comment} »
            </p>
          )}
        </div>
      </div>

      {/* Bloc réponse */}
      <div className="mt-5 border-t border-gray-200 pt-5">
        {hasResponse && !editing ? (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[12px] font-semibold uppercase tracking-wider text-terroir-green-700">
                Votre réponse
              </div>
              <span className="font-mono text-[11px] text-gray-500">
                {row.responseAt && `Publiée le ${formatDate(row.responseAt)}`}
                {row.responseUpdatedAt && ` · modifiée le ${formatDate(row.responseUpdatedAt)}`}
              </span>
            </div>
            <p className="mt-2 rounded-md bg-terroir-bg p-3 text-[14px] leading-relaxed text-gray-800">
              {row.response}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {isLocked ? (
                <span className="rounded-md bg-gray-100 px-3 py-1 text-[12px] text-gray-600">
                  Réponse figée
                </span>
              ) : (
                <>
                  <span className="text-[12px] text-gray-500">
                    {row.responseLockedAt && formatHoursLeft(row.responseLockedAt)}
                  </span>
                  <TableActionButton
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setText(row.response ?? '');
                      setEditing(true);
                    }}
                    disabled={busy}
                  >
                    Modifier
                  </TableActionButton>
                  <TableActionButton
                    variant="ghost-danger"
                    size="sm"
                    onClick={remove}
                    disabled={busy}
                  >
                    Supprimer
                  </TableActionButton>
                </>
              )}
            </div>
            {error && <p className="mt-2 text-[12px] text-red-700">{error}</p>}
          </div>
        ) : editing || !hasResponse ? (
          <div>
            <div className="text-[12px] font-semibold uppercase tracking-wider text-terroir-green-700">
              {hasResponse ? 'Modifier votre réponse' : 'Répondre à cet avis'}
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 500))}
              maxLength={500}
              rows={4}
              className="mt-2 w-full rounded-md border border-gray-300 p-3 text-[14px] focus:border-terroir-green-700 focus:outline-none focus:ring-1 focus:ring-terroir-green-700"
              placeholder="Votre réponse publique (max 500 caractères)"
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[12px] text-gray-500">
                {text.length} / 500 caractères
              </span>
              <div className="flex gap-2">
                {editing && (
                  <TableActionButton
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditing(false);
                      setText(row.response ?? '');
                      setError(null);
                    }}
                    disabled={busy}
                  >
                    Annuler
                  </TableActionButton>
                )}
                <TableActionButton
                  variant="primary"
                  size="sm"
                  onClick={submit}
                  disabled={busy || text.trim().length === 0}
                >
                  {busy ? 'Publication…' : hasResponse ? 'Enregistrer' : 'Publier la réponse'}
                </TableActionButton>
              </div>
            </div>
            {error && <p className="mt-2 text-[12px] text-red-700">{error}</p>}
          </div>
        ) : null}
      </div>
    </article>
  );
}
