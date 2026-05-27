'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button, CodeCommande, OrderStatusBadge, type OrderStatus, StarRating, Textarea } from '@/components/ui';
import { OrderProvenance } from '@/components/consumer/OrderProvenance';

export type OrderDetailData = {
  id: string;
  codeCommande: string | null;
  statut: OrderStatus;
  createdAt: string;
  total: number;
  items: { name: string; qty: string; price: number }[];
  producer: { name: string; slug: string; address: string; lat: number | null; lng: number | null };
  slot: { dateLabel: string; timeLabel: string };
  hasReview: boolean;
};

const STEPS: { key: OrderStatus; label: string }[] = [
  { key: 'pending', label: 'Commandé' },
  { key: 'confirmed', label: 'Confirmé' },
  { key: 'completed', label: 'Retiré' },
];

export function OrderDetailClient({ data }: { data: OrderDetailData }) {
  const o = data;
  const showCode = o.statut === 'confirmed';
  const showReview = o.statut === 'completed' && !o.hasReview;
  const currentIdx = STEPS.findIndex((s) => s.key === o.statut);

  const [rating, setRating] = useState(0);
  const [review, setReview] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rating === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/reviews/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: o.id,
          note: rating,
          commentaire: review.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? 'Publication impossible');
        return;
      }
      setSubmitted(true);
    } catch {
      setError('Erreur de connexion');
    } finally {
      setSubmitting(false);
    }
  };

  const mapsUrl = o.producer.lat !== null && o.producer.lng !== null
    ? `https://www.google.com/maps/search/?api=1&query=${o.producer.lat},${o.producer.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.producer.address)}`;

  return (
    <section className="max-w-4xl">
      <Link href="/compte/commandes" className="text-[13px] text-dark/60 hover:text-green-900">← Mes commandes</Link>
        <div className="mt-3 flex items-start justify-between gap-4 flex-wrap">
          <div>
            {o.codeCommande && <div className="text-[12px] text-dark/50">{o.codeCommande}</div>}
            <h1 className="font-serif text-[40px] md:text-[48px] text-green-900 leading-tight">{o.producer.name}</h1>
            <div className="text-[14px] text-dark/60 mt-1">Commandé le {o.createdAt}</div>
          </div>
          <OrderStatusBadge status={o.statut} />
        </div>

        {o.statut !== 'cancelled' && o.statut !== 'refunded' && (
          <div className="mt-10 bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6 md:p-8">
            <div className="relative">
              <div className="absolute left-0 right-0 top-4 h-0.5 bg-dark/10" />
              <div
                className="absolute left-0 top-4 h-0.5 bg-green-700 transition-all"
                style={{ width: `${Math.max(0, currentIdx) / (STEPS.length - 1) * 100}%` }}
              />
              <ol className="relative grid grid-cols-4">
                {STEPS.map((s, i) => {
                  const done = i <= currentIdx;
                  const active = i === currentIdx;
                  return (
                    <li key={s.key} className="flex flex-col items-center">
                      <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-[12px] font-semibold ${
                        done ? 'bg-green-700 border-green-700 text-white' : 'bg-white border-dark/15 text-dark/40'
                      } ${active ? 'ring-4 ring-green-700/15' : ''}`}>
                        {done ? '✓' : i + 1}
                      </div>
                      <div className={`mt-2 text-[13px] font-medium ${done ? 'text-green-900' : 'text-dark/50'}`}>{s.label}</div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        )}

        {showCode && o.codeCommande && (
          <div className="mt-8">
            <CodeCommande code={o.codeCommande} />
            <p className="mt-3 text-center text-[13px] text-dark/70">Présentez ce code au producteur lors du retrait.</p>
          </div>
        )}

        <div className="mt-10 grid md:grid-cols-2 gap-6">
          <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
            <div className="text-[11px] uppercase tracking-[0.14em] text-terra-700 font-semibold mb-3">Produits commandés</div>
            <ul className="divide-y divide-dark/[0.06]">
              {o.items.map((it, i) => (
                <li key={i} className="py-3 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-[15px] text-dark font-medium">{it.name}</div>
                    <div className="text-[12px] text-dark/50">{it.qty}</div>
                  </div>
                  <div className="font-serif text-[18px] text-green-900 tabular-nums">{it.price.toFixed(2).replace('.', ',')} €</div>
                </li>
              ))}
            </ul>
            <div className="border-t border-dark/[0.08] mt-3 pt-3 flex items-baseline justify-between">
              <span className="font-serif text-[18px] text-green-900">Total</span>
              <span className="font-serif text-[24px] text-green-900 tabular-nums">{o.total.toFixed(2).replace('.', ',')} €</span>
            </div>
          </section>

          <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
            <div className="text-[11px] uppercase tracking-[0.14em] text-terra-700 font-semibold mb-3">Retrait à la ferme</div>
            <div className="font-serif text-[20px] text-green-900">{o.producer.name}</div>
            <div className="text-[14px] text-dark/70 mt-0.5">{o.producer.address}</div>
            <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-green-100 text-green-900 text-[13px] font-medium">
              🕐 {o.slot.dateLabel} · {o.slot.timeLabel}
            </div>
            <div className="mt-5 flex gap-2 flex-wrap">
              <a href={mapsUrl} target="_blank" rel="noopener noreferrer">
                <Button variant="secondary" size="sm">📍 Itinéraire Google Maps</Button>
              </a>
            </div>
          </section>
        </div>

        <div className="mt-8">
          <OrderProvenance
            producerName={o.producer.name}
            producerLat={o.producer.lat}
            producerLng={o.producer.lng}
          />
        </div>

        {showReview && (
          <section className="mt-8 bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6 md:p-8">
            <div className="text-[11px] uppercase tracking-[0.14em] text-terra-700 font-semibold">Ton avis</div>
            <h2 className="mt-2 font-serif text-[28px] text-green-900 leading-tight">Comment s&apos;est passée ta commande ?</h2>

            {submitted ? (
              <div className="mt-5 p-4 rounded-xl bg-green-100/60 border border-green-300/40 text-[14px] text-green-900">
                ✓ Merci pour ton avis ! Il sera publié après modération.
              </div>
            ) : (
              <form onSubmit={submitReview} className="mt-5 space-y-4">
                <div>
                  <div className="text-[12px] text-dark/70 font-medium mb-2">Ta note</div>
                  <StarRating value={rating} onChange={setRating} size="lg" />
                </div>
                <Textarea
                  label="Ton commentaire"
                  rows={4}
                  value={review}
                  onChange={(e) => setReview(e.target.value)}
                  placeholder="Parle de la qualité, de l'accueil, du produit…"
                />
                {error && <p className="text-[13px] text-terra-700">{error}</p>}
                <Button type="submit" disabled={rating === 0 || submitting}>
                  {submitting ? 'Publication…' : 'Publier mon avis'}
                </Button>
              </form>
            )}
          </section>
        )}

        {o.hasReview && o.statut === 'completed' && (
          <section className="mt-8 p-4 rounded-xl bg-green-100/60 border border-green-300/40 text-[14px] text-green-900 text-center">
            Merci, ton avis a déjà été enregistré.
          </section>
        )}
    </section>
  );
}
