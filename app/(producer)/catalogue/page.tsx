'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button, Badge } from '@/components/ui';
import { ProducerLayout } from '../_components/ProducerLayout';

type Product = { id: string; name: string; category: string; price: number; unit: string; stock: number; unlimited: boolean; active: boolean };

const INITIAL: Product[] = [
  { id: 'entrecote', name: 'Entrecôte maturée 21 jours', category: 'Bœuf', price: 34.5, unit: 'kg', stock: 5, unlimited: false, active: true },
  { id: 'roti', name: 'Rôti de bœuf Charolais', category: 'Bœuf', price: 24.9, unit: 'kg', stock: 12, unlimited: false, active: true },
  { id: 'bourguignon', name: 'Bourguignon Charolais', category: 'Bœuf', price: 19.9, unit: 'kg', stock: 22, unlimited: false, active: true },
  { id: 'gigot', name: "Gigot d'agneau de pré", category: 'Agneau', price: 28, unit: 'kg', stock: 3, unlimited: false, active: true },
  { id: 'merguez', name: 'Merguez maison', category: 'Agneau', price: 18.5, unit: 'kg', stock: 0, unlimited: false, active: false },
  { id: 'colis', name: 'Colis découverte 5 kg', category: 'Colis', price: 89, unit: 'colis', stock: 8, unlimited: false, active: true },
  { id: 'steak', name: 'Steak haché frais', category: 'Bœuf', price: 16.9, unit: 'kg', stock: 0, unlimited: true, active: true },
];

export default function ProducerCataloguePage() {
  const [products, setProducts] = useState(INITIAL);
  const toggle = (id: string) => setProducts((arr) => arr.map((p) => p.id === id ? { ...p, active: !p.active } : p));

  return (
    <ProducerLayout>
      <div className="max-w-6xl mx-auto px-8 py-10">
        <header className="mb-8 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold">Catalogue</div>
            <h1 className="mt-1 font-serif text-[40px] text-green-900 leading-tight">Vos produits</h1>
            <p className="text-[14px] text-dark/60 mt-1">{products.filter((p) => p.active).length} produits actifs · {products.length} au total</p>
          </div>
          <Link href="/catalogue/nouveau"><Button size="lg">+ Ajouter un produit</Button></Link>
        </header>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {products.map((p) => {
            const lowStock = !p.unlimited && p.stock > 0 && p.stock < 5;
            const empty = !p.unlimited && p.stock === 0;
            return (
              <article key={p.id} className={`bg-white rounded-2xl border shadow-soft overflow-hidden transition-opacity ${
                p.active ? 'border-dark/[0.06]' : 'border-dark/[0.04] opacity-60'
              }`}>
                <div className="aspect-[4/3] relative flex items-center justify-center text-green-900/30 font-mono text-[10px] uppercase"
                     style={{ backgroundImage: 'repeating-linear-gradient(45deg, #D8F3DC 0 12px, #C9EAD0 12px 24px)' }}>
                  Photo produit
                  <div className="absolute top-3 left-3"><Badge variant="terra">{p.category}</Badge></div>
                  {lowStock && <div className="absolute top-3 right-3"><Badge variant="terra">Stock faible</Badge></div>}
                  {empty && <div className="absolute top-3 right-3"><Badge variant="gray">Épuisé</Badge></div>}
                </div>
                <div className="p-4">
                  <h3 className="font-serif text-[18px] text-green-900 leading-tight">{p.name}</h3>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="font-serif text-[22px] text-green-900 tabular-nums">{p.price.toFixed(2).replace('.', ',')} €</span>
                    <span className="text-[12px] text-dark/55">/ {p.unit}</span>
                  </div>
                  <div className="mt-1 text-[12px] text-dark/60 mono">{p.unlimited ? '∞ illimité' : `${p.stock} ${p.unit} en stock`}</div>
                  <div className="mt-4 pt-4 border-t border-dark/[0.06] flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <span className="text-[12px] text-dark/60 font-medium">{p.active ? 'Actif' : 'Inactif'}</span>
                      <span className={`relative w-9 h-5 rounded-full transition-colors ${p.active ? 'bg-green-700' : 'bg-dark/20'}`}>
                        <input type="checkbox" className="sr-only" checked={p.active} onChange={() => toggle(p.id)} />
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${p.active ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                      </span>
                    </label>
                    <Link href={`/catalogue/${p.id}`} className="text-[13px] text-green-700 font-medium hover:text-green-900">Modifier →</Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </ProducerLayout>
  );
}
