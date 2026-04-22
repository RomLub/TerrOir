'use client';

import { useEffect, useState } from 'react';
import { AdminPageHeader, MetricCard, StarRating, StatusPanel } from '@/components/ui';
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

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function AdminAvisPage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const supabase = createSupabaseBrowserClient();

    (async () => {
      const { data, error: fetchError } = await supabase
        .from('reviews')
        .select(`
          id, note, commentaire, created_at,
          consumer:consumer_id ( prenom, nom ),
          producer:producer_id ( nom_exploitation, slug )
        `)
        .eq('statut', 'pending')
        .order('created_at', { ascending: false });

      if (!active) return;
      if (fetchError) { setError(fetchError.message); setLoading(false); return; }

      const rows: Review[] = ((data ?? []) as unknown as Array<{
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

      setReviews(rows);
      setLoading(false);
    })();

    return () => { active = false; };
  }, []);

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
                <button onClick={() => moderate(r.id, 'reject')} disabled={busy === r.id}
                  className="rounded-md px-4 py-2 text-[13px] font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-60">
                  Rejeter
                </button>
                <button onClick={() => moderate(r.id, 'publish')} disabled={busy === r.id}
                  className="rounded-md bg-terroir-green-700 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-terroir-green-700/90 disabled:opacity-60">
                  {busy === r.id ? 'Publication…' : 'Publier'}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
