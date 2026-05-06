'use client';

import { useEffect, useState } from 'react';
import { AdminPageHeader, MetricCard, StarRating, StatusPanel, TableActionButton } from '@/components/ui';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

type Review = {
  id: string;
  author: string;
  rating: number;
  comment: string;
  producer: string;
  producerSlug: string;
  date: string;
};

type ReviewWithResponse = Review & {
  response: string;
  responseAt: string;
  responseStatus: 'published';
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function AdminAvisPage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [responses, setResponses] = useState<ReviewWithResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const supabase = createSupabaseBrowserClient();

    (async () => {
      const [pendingRes, withResponseRes] = await Promise.all([
        supabase
          .from('reviews')
          .select(`
            id, note, commentaire, created_at,
            consumer:consumer_id ( prenom, nom ),
            producer:producer_id ( nom_exploitation, slug )
          `)
          .eq('statut', 'pending')
          .order('created_at', { ascending: false }),
        supabase
          .from('reviews')
          .select(`
            id, note, commentaire, created_at,
            producer_response, producer_response_at, producer_response_status,
            consumer:consumer_id ( prenom, nom ),
            producer:producer_id ( nom_exploitation, slug )
          `)
          .eq('statut', 'published')
          .eq('producer_response_status', 'published')
          .not('producer_response', 'is', null)
          .order('producer_response_at', { ascending: false, nullsFirst: false })
          .limit(50),
      ]);

      if (!active) return;
      if (pendingRes.error) { setError(pendingRes.error.message); setLoading(false); return; }
      if (withResponseRes.error) { setError(withResponseRes.error.message); setLoading(false); return; }

      const pendingRows: Review[] = ((pendingRes.data ?? []) as unknown as Array<{
        id: string;
        note: number;
        commentaire: string | null;
        created_at: string;
        consumer: { prenom: string | null; nom: string | null } | Array<{ prenom: string | null; nom: string | null }> | null;
        producer: { nom_exploitation: string; slug: string } | Array<{ nom_exploitation: string; slug: string }> | null;
      }>).map((r) => {
        const consumer = Array.isArray(r.consumer) ? r.consumer[0] : r.consumer;
        const producer = Array.isArray(r.producer) ? r.producer[0] : r.producer;
        const author = [consumer?.prenom, consumer?.nom?.[0]].filter(Boolean).join(' ').trim() || 'Anonyme';
        return {
          id: r.id,
          author: author + (consumer?.nom?.[0] ? '.' : ''),
          rating: r.note,
          comment: r.commentaire ?? '',
          producer: producer?.nom_exploitation ?? '—',
          producerSlug: producer?.slug ?? '',
          date: formatDate(r.created_at),
        };
      });

      const responseRows: ReviewWithResponse[] = ((withResponseRes.data ?? []) as unknown as Array<{
        id: string;
        note: number;
        commentaire: string | null;
        created_at: string;
        producer_response: string;
        producer_response_at: string;
        producer_response_status: 'published';
        consumer: { prenom: string | null; nom: string | null } | Array<{ prenom: string | null; nom: string | null }> | null;
        producer: { nom_exploitation: string; slug: string } | Array<{ nom_exploitation: string; slug: string }> | null;
      }>).map((r) => {
        const consumer = Array.isArray(r.consumer) ? r.consumer[0] : r.consumer;
        const producer = Array.isArray(r.producer) ? r.producer[0] : r.producer;
        const author = [consumer?.prenom, consumer?.nom?.[0]].filter(Boolean).join(' ').trim() || 'Anonyme';
        return {
          id: r.id,
          author: author + (consumer?.nom?.[0] ? '.' : ''),
          rating: r.note,
          comment: r.commentaire ?? '',
          producer: producer?.nom_exploitation ?? '—',
          producerSlug: producer?.slug ?? '',
          date: formatDate(r.created_at),
          response: r.producer_response,
          responseAt: formatDate(r.producer_response_at),
          responseStatus: r.producer_response_status,
        };
      });

      setReviews(pendingRows);
      setResponses(responseRows);
      setLoading(false);
    })();

    return () => { active = false; };
  }, []);

  const removeResponse = async (id: string) => {
    if (!confirm('Supprimer cette réponse producer (modération abusive) ?')) return;
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/reviews/${id}/response`, { method: 'DELETE' });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? 'Suppression impossible');
        return;
      }
      setResponses((arr) => arr.filter((r) => r.id !== id));
    } catch {
      setError('Erreur de connexion');
    } finally {
      setBusy(null);
    }
  };

  const moderate = async (id: string, action: 'publish' | 'reject') => {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/reviews/${id}/moderate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? 'Modération impossible');
        return;
      }
      setReviews((arr) => arr.filter((r) => r.id !== id));
    } catch {
      setError('Erreur de connexion');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <AdminPageHeader
        eyebrow="Modération"
        title="Avis à modérer"
        subtitle="Validez chaque avis avant publication sur la page du producteur."
        error={error}
        right={<MetricCard size="sm" label="En attente" value={reviews.length} />}
      />

      {loading ? (
        <StatusPanel kind="loading" label="Chargement…" />
      ) : reviews.length === 0 ? (
        <StatusPanel
          kind="success-empty"
          label="Tout est à jour"
          subtitle="Aucun avis en attente de modération."
          icon={
            <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-terroir-green-700 bg-terroir-green-100">
              <svg width="36" height="36" viewBox="0 0 48 48" className="text-terroir-green-700">
                <path d="M12 24 L20 32 L36 16" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          }
        />
      ) : (
        <div className="space-y-4">
          {reviews.map((r) => (
            <article key={r.id} className="rounded-md border border-gray-200 bg-white p-6 shadow-sm transition-colors hover:border-gray-300">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <StarRating value={r.rating} readOnly size="md" />
                    <span className="font-serif text-[18px] text-gray-900">{r.author}</span>
                    <span className="font-mono text-[12px] text-gray-500">{r.date}</span>
                  </div>
                  <p className="mt-3 text-[15px] italic leading-relaxed text-gray-700">
                    {r.comment ? `« ${r.comment} »` : 'Pas de commentaire.'}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
                    <span className="text-gray-500">Pour</span>
                    <span className="font-medium text-terroir-green-700">{r.producer}</span>
                  </div>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-gray-200 pt-5">
                <TableActionButton variant="ghost-danger" size="md" onClick={() => moderate(r.id, 'reject')} disabled={busy === r.id}>
                  Rejeter
                </TableActionButton>
                <TableActionButton variant="primary" size="md" onClick={() => moderate(r.id, 'publish')} disabled={busy === r.id}>
                  {busy === r.id ? 'Publication…' : 'Publier'}
                </TableActionButton>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Section : réponses producer publiées (modération a posteriori CGU 6.4) */}
      <div className="mt-12">
        <header className="mb-4 border-b border-gray-200 pb-3">
          <h2 className="font-serif text-[20px] text-gray-900">Réponses producer publiées</h2>
          <p className="mt-1 text-[13px] text-gray-600">
            Les producteurs peuvent répondre aux avis publiés. L&apos;admin
            peut supprimer une réponse abusive (override de la fenêtre 24h).
          </p>
        </header>

        {!loading && responses.length === 0 ? (
          <div className="rounded-md border border-gray-200 bg-white p-6 text-center text-[14px] text-gray-600">
            Aucune réponse producer publiée pour le moment.
          </div>
        ) : (
          <div className="space-y-4">
            {responses.map((r) => (
              <article key={r.id} className="rounded-md border border-gray-200 bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <StarRating value={r.rating} readOnly size="md" />
                      <span className="font-serif text-[18px] text-gray-900">{r.author}</span>
                      <span className="font-mono text-[12px] text-gray-500">{r.date}</span>
                    </div>
                    {r.comment && (
                      <p className="mt-3 text-[15px] italic leading-relaxed text-gray-700">« {r.comment} »</p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
                      <span className="text-gray-500">Pour</span>
                      <span className="font-medium text-terroir-green-700">{r.producer}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-md bg-terroir-bg/50 border-l-4 border-terroir-terra-700 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-terroir-green-700">
                    Réponse du producteur · {r.responseAt}
                  </div>
                  <p className="mt-1 text-[14px] text-gray-800">{r.response}</p>
                </div>

                <div className="mt-4 flex justify-end border-t border-gray-200 pt-4">
                  <TableActionButton
                    variant="ghost-danger"
                    size="md"
                    onClick={() => removeResponse(r.id)}
                    disabled={busy === r.id}
                  >
                    {busy === r.id ? 'Suppression…' : 'Supprimer la réponse'}
                  </TableActionButton>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
