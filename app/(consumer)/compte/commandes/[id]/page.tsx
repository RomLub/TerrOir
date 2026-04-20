'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button, CodeCommande, OrderStatusBadge, StarRating, Textarea, NavbarPublic, Footer } from '@/components/ui';

type Status = 'pending' | 'confirmed' | 'ready' | 'completed' | 'cancelled';

const ORDER = {
  id: 'TRO-7A9K2X',
  status: 'confirmed' as Status,
  createdAt: '20 avril 2026 à 14h32',
  reviewed: false,
  items: [
    { name: 'Entrecôte maturée 21 jours', qty: '1,50 kg', price: 51.75 },
    { name: 'Rôti de bœuf Charolais', qty: '2,00 kg', price: 49.80 },
  ],
  total: 101.55,
  producer: {
    name: 'Ferme des Chênes',
    slug: 'ferme-des-chenes',
    address: "Route de la Vallée, 72250 Parigné-l'Évêque",
    lat: 47.9458, lng: 0.3239,
  },
  slot: { date: 'Samedi 25 avril 2026', time: '10h00 – 12h00' },
};

const STEPS: { key: Status; label: string }[] = [
  { key: 'pending', label: 'Commandé' },
  { key: 'confirmed', label: 'Confirmé' },
  { key: 'ready', label: 'Prêt' },
  { key: 'completed', label: 'Retiré' },
];

export default function OrderDetailPage({ params }: { params: { id: string } }) {
  const o = ORDER;
  const orderId = params.id || o.id;
  const showCode = o.status === 'confirmed' || o.status === 'ready';
  const showReview = o.status === 'completed' && !o.reviewed;

  const currentIdx = STEPS.findIndex((s) => s.key === o.status);

  const [rating, setRating] = useState(0);
  const [review, setReview] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const submitReview = (e: React.FormEvent) => {
    e.preventDefault();
    if (rating === 0) return;
    setSubmitted(true);
  };

  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${o.producer.lat},${o.producer.lng}`;

  return (
    <div className="min-h-screen bg-bg">
      <NavbarPublic />
      <section className="max-w-4xl mx-auto px-6 py-10">
        <Link href="/compte/commandes" className="text-[13px] text-dark/60 hover:text-green-900">← Mes commandes</Link>
        <div className="mt-3 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[12px] mono text-dark/50">{orderId}</div>
            <h1 className="font-serif text-[40px] md:text-[48px] text-green-900 leading-tight">{o.producer.name}</h1>
            <div className="text-[14px] text-dark/60 mt-1">Commandé le {o.createdAt}</div>
          </div>
          <OrderStatusBadge status={o.status} />
        </div>

        {o.status !== 'cancelled' && (
          <div className="mt-10 bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6 md:p-8">
            <div className="relative">
              <div className="absolute left-0 right-0 top-4 h-0.5 bg-dark/10" />
              <div
                className="absolute left-0 top-4 h-0.5 bg-green-700 transition-all"
                style={{ width: `${(currentIdx / (STEPS.length - 1)) * 100}%` }}
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

        {showCode && (
          <div className="mt-8">
            <CodeCommande code={orderId} />
            <p className="mt-3 text-center text-[13px] text-dark/70">Présentez ce code au producteur lors du retrait.</p>
          </div>
        )}

        <div className="mt-10 grid md:grid-cols-2 gap-6">
          <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
            <div className="text-[11px] uppercase tracking-[0.14em] text-terra-700 font-semibold mb-3">Produits commandés</div>
            <ul className="divide-y divide-dark/[0.06]">
              {o.items.map((it) => (
                <li key={it.name} className="py-3 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-[15px] text-dark font-medium">{it.name}</div>
                    <div className="text-[12px] text-dark/50 mono">{it.qty}</div>
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
              🕐 {o.slot.date} · {o.slot.time}
            </div>
            <div className="mt-5 flex gap-2 flex-wrap">
              <a href={mapsUrl} target="_blank" rel="noopener noreferrer">
                <Button variant="secondary" size="sm">📍 Itinéraire Google Maps</Button>
              </a>
              <Button variant="ghost" size="sm" disabled>✉ Contacter le producteur</Button>
            </div>
            <p className="mt-2 text-[11px] text-dark/45">La messagerie arrive bientôt.</p>
          </section>
        </div>

        {showReview && (
          <section className="mt-8 bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6 md:p-8">
            <div className="text-[11px] uppercase tracking-[0.14em] text-terra-700 font-semibold">Votre avis</div>
            <h2 className="mt-2 font-serif text-[28px] text-green-900 leading-tight">Comment s&apos;est passée votre commande ?</h2>

            {submitted ? (
              <div className="mt-5 p-4 rounded-xl bg-green-100/60 border border-green-300/40 text-[14px] text-green-900">
                ✓ Merci pour votre avis ! Il aidera d&apos;autres consommateurs.
              </div>
            ) : (
              <form onSubmit={submitReview} className="mt-5 space-y-4">
                <div>
                  <div className="text-[12px] text-dark/70 font-medium mb-2">Votre note</div>
                  <StarRating value={rating} onChange={setRating} size="lg" />
                </div>
                <Textarea
                  label="Votre commentaire"
                  rows={4}
                  value={review}
                  onChange={(e) => setReview(e.target.value)}
                  placeholder="Parlez de la qualité, de l'accueil, du produit…"
                />
                <Button type="submit" disabled={rating === 0}>Publier mon avis</Button>
              </form>
            )}
          </section>
        )}
      </section>
      <Footer />
    </div>
  );
}
