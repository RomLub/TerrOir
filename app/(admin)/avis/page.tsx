'use client';

import { useMemo, useState } from 'react';
import { StarRating } from '@/components/ui';
import { AdminLayout } from '../_components/AdminLayout';

type ReviewStatus = 'pending' | 'published' | 'rejected';

type Review = {
  id: string;
  author: string;
  rating: number;
  comment: string;
  producer: string;
  producerSlug: string;
  product?: string;
  date: string;
  status: ReviewStatus;
};

const INITIAL: Review[] = [
  { id: 'r1', author: 'Camille R.', rating: 5, comment: "Viande exceptionnelle, maturation parfaite. On goûte immédiatement la différence avec la grande distribution. Je recommande à 1000%.", producer: 'Ferme des Chênes', producerSlug: 'ferme-des-chenes', product: 'Entrecôte maturée 21 jours', date: '19 avr. 2026', status: 'pending' },
  { id: 'r2', author: 'Thomas V.', rating: 4, comment: "Très bon produit, livraison au créneau impeccable. Petit bémol sur l'emballage qui pourrait être un peu plus qualitatif pour un cadeau.", producer: 'Domaine Saint-Martin', producerSlug: 'domaine-saint-martin', product: 'Coffret Pinot Noir', date: '18 avr. 2026', status: 'pending' },
  { id: 'r3', author: 'Marie D.', rating: 5, comment: "Lucie est adorable et ses légumes ont un vrai goût. Le panier de la semaine est devenu un rituel familial.", producer: 'Le Potager de Lucie', producerSlug: 'potager-de-lucie', product: 'Panier de saison', date: '17 avr. 2026', status: 'pending' },
  { id: 'r4', author: 'Antoine M.', rating: 2, comment: "Déçu, la commande n'était pas prête au créneau annoncé et j'ai dû repasser. Dommage car les produits sont bons.", producer: 'Bergerie du Causse', producerSlug: 'bergerie-du-causse', date: '16 avr. 2026', status: 'pending' },
  { id: 'r5', author: 'Hélène T.', rating: 5, comment: "Miel de lavande sublime, texture parfaite, goût intense. Devenu mon cadeau préféré.", producer: "La Ruche d'Or", producerSlug: 'ruche-d-or', product: 'Miel de lavande 500g', date: '14 avr. 2026', status: 'pending' },
  { id: 'r6', author: 'Julien K.', rating: 3, comment: "Correct mais sans plus, le rapport qualité-prix me semble un peu juste sur ce colis.", producer: 'Ferme des Chênes', producerSlug: 'ferme-des-chenes', product: 'Colis découverte 5 kg', date: '12 avr. 2026', status: 'pending' },
];

export default function AdminAvisPage() {
  const [reviews, setReviews] = useState(INITIAL);
  const pending = useMemo(() => reviews.filter((r) => r.status === 'pending'), [reviews]);

  const setStatus = (id: string, status: ReviewStatus) =>
    setReviews((arr) => arr.map((r) => r.id === id ? { ...r, status } : r));

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto px-8 py-10">
        <header className="mb-8 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-green-400 font-semibold">Modération</div>
            <h1 className="mt-1 font-serif text-[40px] text-white leading-tight">Avis à modérer</h1>
            <p className="text-[14px] text-white/55 mt-1">Validez chaque avis avant publication sur la page du producteur.</p>
          </div>
          <div className="bg-black/40 border border-white/[0.08] rounded-xl px-5 py-4 text-center">
            <div className="text-[11px] uppercase tracking-[0.14em] text-green-400 font-semibold">En attente</div>
            <div className="mt-1 font-serif text-[40px] text-white leading-none tabular-nums">{pending.length}</div>
          </div>
        </header>

        {pending.length === 0 ? (
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
            {pending.map((r) => (
              <article key={r.id} className="bg-black/30 border border-white/[0.06] rounded-2xl p-6 hover:border-white/[0.12] transition-colors">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <StarRating value={r.rating} readOnly size="md" />
                      <span className="font-serif text-[18px] text-white">{r.author}</span>
                      <span className="text-[12px] text-white/45 font-mono">{r.date}</span>
                    </div>
                    <p className="mt-3 text-[15px] text-white/85 leading-relaxed italic">« {r.comment} »</p>
                    <div className="mt-3 flex items-center gap-2 flex-wrap text-[12px]">
                      <span className="text-white/45">Pour</span>
                      <span className="text-green-300 font-medium">{r.producer}</span>
                      {r.product && (
                        <>
                          <span className="text-white/30">·</span>
                          <span className="text-white/65">{r.product}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-5 pt-5 border-t border-white/[0.06] flex gap-2 justify-end flex-wrap">
                  <button onClick={() => setStatus(r.id, 'rejected')}
                    className="px-4 py-2 rounded-md text-[13px] font-medium text-red-300 bg-white/[0.03] hover:bg-red-500/20 transition-colors">
                    Rejeter
                  </button>
                  <button onClick={() => setStatus(r.id, 'published')}
                    className="px-4 py-2 rounded-md text-[13px] font-semibold text-white bg-green-700 hover:bg-green-600 transition-colors">
                    Publier
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
