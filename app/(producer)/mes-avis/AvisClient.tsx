'use client';

import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { FilterTabs, type FilterTabOption } from '@/components/ui/filter-tabs';
import { PageHeader } from '@/components/ui/page-header';
import { StarRating } from '@/components/ui/star-rating';
import { TableActionButton } from '@/components/ui/table-action-button';
import { Textarea } from '@/components/ui/textarea';
import {
  compareReviewConversationState,
  getReviewConversationState,
  type ReviewConversationSender,
} from '@/lib/producers/review-conversation-state';

type Tab = 'all' | 'needs-response' | 'answered' | 'unread';

const FILTERS: ReadonlyArray<FilterTabOption<Tab>> = [
  { value: 'all', label: 'Tous' },
  { value: 'needs-response', label: 'À répondre' },
  { value: 'answered', label: 'Répondus' },
  { value: 'unread', label: 'Non lus' },
];

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
  producerReadAt: string | null;
  lastMessageSender: ReviewConversationSender;
  lastMessageAt: string | null;
  needsResponse: boolean;
  unread: boolean;
};

function formatDate(iso: string | null): string {
  if (!iso) return '-';
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

function applyConversationState(row: AvisRow): AvisRow {
  const conversation = getReviewConversationState({
    createdAt: row.createdAt,
    publishedAt: row.publishedAt,
    producerResponse: row.response,
    producerResponseAt: row.responseAt,
    producerResponseUpdatedAt: row.responseUpdatedAt,
    producerResponseStatus: row.responseStatus,
    producerReadAt: row.producerReadAt,
  });

  return { ...row, ...conversation };
}

export function AvisClient({ initialRows }: { initialRows: AvisRow[] }) {
  const [rows, setRows] = useState<AvisRow[]>(initialRows);
  const [tab, setTab] = useState<Tab>('all');
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => compareReviewConversationState(a, b)),
    [rows],
  );

  const stats = useMemo(() => {
    const total = rows.length;
    const needsResponse = rows.filter((r) => r.needsResponse).length;
    const answered = rows.filter((r) => !r.needsResponse).length;
    const unread = rows.filter((r) => r.unread).length;
    const avg =
      total > 0 ? rows.reduce((s, r) => s + r.rating, 0) / total : 0;
    return { total, needsResponse, answered, unread, avg };
  }, [rows]);

  const counts = useMemo<Record<Tab, number>>(
    () => ({
      all: stats.total,
      'needs-response': stats.needsResponse,
      answered: stats.answered,
      unread: stats.unread,
    }),
    [stats],
  );

  const visibleRows = useMemo(
    () =>
      sortedRows.filter((row) => {
        if (tab === 'needs-response') return row.needsResponse;
        if (tab === 'answered') return !row.needsResponse;
        if (tab === 'unread') return row.unread;
        return true;
      }),
    [sortedRows, tab],
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 md:px-8 md:py-10">
      <PageHeader
        tone="producer"
        eyebrow="Ventes"
        title="Mes avis"
        subtitle="Suivez les avis clients, les conversations à reprendre et les nouveaux messages."
      />

      <div className="-mt-4 mb-6 flex flex-wrap gap-3 text-[13px]">
        <Badge variant="terra">{stats.needsResponse} à répondre</Badge>
        <Badge variant="green">{stats.answered} répondus</Badge>
        <Badge variant="blue">{stats.unread} non lus</Badge>
        {stats.total > 0 && (
          <Badge variant="neutral">Moyenne {stats.avg.toFixed(1)} / 5</Badge>
        )}
      </div>

      <div className="border-b border-dark/[0.08]">
        <FilterTabs filters={FILTERS} counts={counts} active={tab} onChange={setTab} />
      </div>

      {rows.length === 0 ? (
        <div className="mt-6 rounded-md border border-gray-200 bg-white p-8 text-center shadow-sm">
          <p className="text-[15px] text-gray-700">
            Aucun avis publié pour le moment.
          </p>
          <p className="mt-1 text-[13px] text-gray-500">
            Vos clients pourront laisser un avis après une commande terminée.
          </p>
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="mt-6 rounded-md border border-gray-200 bg-white p-8 text-center shadow-sm">
          <p className="text-[15px] text-gray-700">Aucun avis dans cette vue.</p>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {visibleRows.map((r) => (
            <ReviewCard
              key={r.id}
              row={r}
              open={openIds.has(r.id)}
              onOpenChange={(open) =>
                setOpenIds((current) => {
                  const next = new Set(current);
                  if (open) next.add(r.id);
                  else next.delete(r.id);
                  return next;
                })
              }
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
  open,
  onOpenChange,
  onChange,
}: {
  row: AvisRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (updated: AvisRow) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(row.response ?? '');
  const [busy, setBusy] = useState(false);
  const [readBusy, setReadBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLocked =
    row.responseLockedAt !== null &&
    new Date(row.responseLockedAt).getTime() <= Date.now();
  const hasResponse = row.response !== null;

  const markRead = async () => {
    if (!row.unread || readBusy) return;
    setReadBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/producer/reviews/${row.id}/read`, {
        method: 'POST',
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? 'Lecture impossible');
        return;
      }
      onChange(
        applyConversationState({
          ...row,
          producerReadAt: body.readAt ?? new Date().toISOString(),
        }),
      );
    } catch {
      setError('Erreur de connexion');
    } finally {
      setReadBusy(false);
    }
  };

  const toggleOpen = () => {
    const nextOpen = !open;
    onOpenChange(nextOpen);
    if (nextOpen) void markRead();
  };

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
      onChange(
        applyConversationState({
          ...row,
          response: text.trim(),
          responseAt: hasResponse ? row.responseAt : now,
          responseUpdatedAt: hasResponse ? now : null,
          responseLockedAt: hasResponse
            ? row.responseLockedAt
            : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          responseStatus: 'published',
          producerReadAt: now,
        }),
      );
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
      const now = new Date().toISOString();
      onChange(
        applyConversationState({
          ...row,
          response: null,
          responseStatus: 'removed_producer',
          producerReadAt: now,
        }),
      );
      setText('');
    } catch {
      setError('Erreur de connexion');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="rounded-md border border-gray-200 bg-white p-6 shadow-sm transition-colors hover:border-gray-300">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <StarRating value={row.rating} readOnly size="md" />
            <span className="font-serif text-[18px] text-gray-900">{row.author}</span>
            <span className="font-mono text-[12px] text-gray-500">
              {formatDate(row.publishedAt ?? row.createdAt)}
            </span>
            <Badge variant={row.needsResponse ? 'terra' : 'green'}>
              {row.needsResponse ? 'À répondre' : 'Répondu'}
            </Badge>
            {row.unread && <Badge variant="blue">Nouveau</Badge>}
          </div>
          {row.comment && (
            <p className="mt-3 text-[15px] italic leading-relaxed text-gray-700">
              &laquo; {row.comment} &raquo;
            </p>
          )}
        </div>
        <TableActionButton
          variant={open ? 'ghost' : 'primary'}
          size="sm"
          onClick={toggleOpen}
          disabled={readBusy}
        >
          {open ? 'Masquer' : readBusy ? 'Ouverture...' : 'Ouvrir'}
        </TableActionButton>
      </div>

      {open ? (
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
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 500))}
              maxLength={500}
              rows={4}
              className="mt-2"
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
                  {busy ? 'Publication...' : hasResponse ? 'Enregistrer' : 'Publier la réponse'}
                </TableActionButton>
              </div>
            </div>
            {error && <p className="mt-2 text-[12px] text-red-700">{error}</p>}
          </div>
        ) : null}
      </div>
      ) : null}
    </article>
  );
}
