'use client';

import { useEffect, useState } from 'react';
import { StarRating } from '@/components/ui';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { AdminLayout } from '../_components/AdminLayout';

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
    <AdminLayout>
      <div className="max-w-5xl mx-auto px-8 py-10">
        <header className="mb-8 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-green-400 font-semibold">Modération</div>
            <h1 className="mt-1 font-serif text-[40px] text-white leading-tight">Avis à modérer</h1>
            <p className="text-[14px] text-white/55 mt-1">Validez chaque avis avant publication sur la page du producteur.</p>
            {error && <p className="mt-2 text-[13px] text-red-300">{error}</p>}
          </div>
          <div className="bg-black/40 border border-white/[0.08] rounded-xl px-5 py-4 text-center">
            <div className="text-[11px] uppercase tracking-[0.14em] text-green-400 font-semibold">En attente</div>
            <div className="mt-1 font-serif text-[40px] text-white leading-none tabular-nums">{reviews.length}</div>
          </div>
        </header>

        {loading ? (
          <div className="bg-black/30 border border-white/[0.06] rounded-2xl p-12 text-center text-white/55">Chargement…</div>
        ) : reviews.length === 0 ? (
          <div className="bg-black/30 border border-white/[0.06] rounded-2xl p-12 text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-green-500/15 border-2 border-green-500 flex items-center justify-center">
              <svg width="36" height="36" viewBox="0 0 48 48" className="text-green-400">
                <path d="M12 24 L20 32 L36 16" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h3 className="mt-4 font-serif text-[24px] text-white">Tout est à jour</h3>
            <p className="text-[14px] text-white/55 mt-1">Aucun avis en attente de modération.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {reviews.map((r) => (
              <article key={r.id} className="bg-black/30 border border-white/[0.06] rounded-2xl p-6 hover:border-white/[0.12] transition-colors">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <StarRating value={r.rating} readOnly size="md" />
                      <span className="font-serif text-[18px] text-white">{r.author}</span>
                      <span className="text-[12px] text-white/45 font-mono">{r.date}</span>
                    </div>
                    <p className="mt-3 text-[15px] text-white/85 leading-relaxed italic">
                      {r.comment ? `« ${r.comment} »` : 'Pas de commentaire.'}
                    </p>
                    <div className="mt-3 flex items-center gap-2 flex-wrap text-[12px]">
                      <span className="text-white/45">Pour</span>
                      <span className="text-green-300 font-medium">{r.producer}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-5 pt-5 border-t border-white/[0.06] flex gap-2 justify-end flex-wrap">
                  <button onClick={() => moderate(r.id, 'reject')} disabled={busy === r.id}
                    className="px-4 py-2 rounded-md text-[13px] font-medium text-red-300 bg-white/[0.03] hover:bg-red-500/20 disabled:opacity-60 transition-colors">
                    Rejeter
                  </button>
                  <button onClick={() => moderate(r.id, 'publish')} disabled={busy === r.id}
                    className="px-4 py-2 rounded-md text-[13px] font-semibold text-white bg-green-700 hover:bg-green-600 disabled:opacity-60 transition-colors">
                    {busy === r.id ? 'Publication…' : 'Publier'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
