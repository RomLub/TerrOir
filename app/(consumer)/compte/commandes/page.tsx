'use client';

import Link from 'next/link';
import { useState, useMemo } from 'react';
import { OrderStatusBadge, NavbarPublic, Footer } from '@/components/ui';

type Status = 'pending' | 'confirmed' | 'ready' | 'completed' | 'cancelled';
type Order = { id: string; date: string; producerName: string; producerSlug: string; total: number; status: Status; itemCount: number };

const ORDERS: Order[] = [
  { id: 'TRO-7A9K2X', date: '20 avril 2026', producerName: 'Ferme des Chênes', producerSlug: 'ferme-des-chenes', total: 101.55, status: 'confirmed', itemCount: 2 },
  { id: 'TRO-4M2P8L', date: '12 avril 2026', producerName: 'Élevage de Loué', producerSlug: 'elevage-loue', total: 42.90, status: 'ready', itemCount: 1 },
  { id: 'TRO-9X3V1B', date: '2 avril 2026', producerName: 'Agneaux de la Forêt', producerSlug: 'agneaux-berce', total: 68.00, status: 'completed', itemCount: 3 },
  { id: 'TRO-6H4R7D', date: '18 mars 2026', producerName: 'Ferme des Chênes', producerSlug: 'ferme-des-chenes', total: 34.50, status: 'completed', itemCount: 1 },
  { id: 'TRO-2K9L5F', date: '5 mars 2026', producerName: 'GAEC du Pré Vert', producerSlug: 'gaec-du-pre-vert', total: 89.00, status: 'cancelled', itemCount: 1 },
];

type Filter = 'all' | 'active' | 'done' | 'cancelled';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Toutes' },
  { value: 'active', label: 'En cours' },
  { value: 'done', label: 'Terminées' },
  { value: 'cancelled', label: 'Annulées' },
];

export default function CommandesPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const filtered = useMemo(() => ORDERS.filter((o) => {
    if (filter === 'all') return true;
    if (filter === 'active') return o.status === 'pending' || o.status === 'confirmed' || o.status === 'ready';
    if (filter === 'done') return o.status === 'completed';
    if (filter === 'cancelled') return o.status === 'cancelled';
    return true;
  }), [filter]);

  return (
    <div className="min-h-screen bg-bg">
      <NavbarPublic />
      <section className="max-w-5xl mx-auto px-6 py-10">
        <h1 className="font-serif text-[40px] md:text-[52px] text-green-900 leading-tight">Mes commandes</h1>
        <p className="text-[14px] text-dark/60 mt-1">{ORDERS.length} commandes au total</p>

        <div className="mt-8 flex gap-1.5 flex-wrap border-b border-dark/[0.08]">
          {FILTERS.map((f) => {
            const active = filter === f.value;
            return (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`px-4 py-3 text-[14px] font-medium transition-colors border-b-2 -mb-px ${
                  active ? 'border-green-700 text-green-900' : 'border-transparent text-dark/60 hover:text-green-900'
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        <div className="mt-6 space-y-3">
          {filtered.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dark/[0.06] p-10 text-center">
              <h3 className="font-serif text-[22px] text-green-900">Aucune commande</h3>
              <p className="text-[13px] text-dark/60 mt-1">Rien à afficher pour ce filtre.</p>
            </div>
          ) : (
            filtered.map((o) => (
              <Link
                key={o.id}
                href={`/compte/commandes/${o.id}`}
                className="block bg-white rounded-2xl border border-dark/[0.06] shadow-soft hover:shadow-card hover:-translate-y-0.5 transition-all p-5"
              >
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-[12px] mono text-dark/50">
                      <span>{o.id}</span><span>·</span><span>{o.date}</span>
                    </div>
                    <div className="mt-1 font-serif text-[22px] text-green-900 leading-tight">{o.producerName}</div>
                    <div className="text-[13px] text-dark/60 mt-0.5">{o.itemCount} article{o.itemCount > 1 ? 's' : ''}</div>
                  </div>
                  <div className="flex items-center gap-5">
                    <OrderStatusBadge status={o.status} />
                    <div className="text-right">
                      <div className="font-serif text-[22px] text-green-900 tabular-nums">{o.total.toFixed(2).replace('.', ',')} €</div>
                    </div>
                    <span className="text-dark/30 text-xl">›</span>
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      </section>
      <Footer />
    </div>
  );
}
