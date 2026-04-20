'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Button, Badge, NavbarPublic, Footer } from '@/components/ui';

type Item = { id: string; producerSlug: string; producerName: string; name: string; price: number; unit: string; qty: number; slot: string };

const INITIAL: Item[] = [
  { id: 'entrecote', producerSlug: 'ferme-des-chenes', producerName: 'Ferme des Chênes', name: 'Entrecôte maturée 21 jours', price: 34.5, unit: 'kg', qty: 1.5, slot: 'Samedi 25 avril · 10h–12h' },
  { id: 'roti', producerSlug: 'ferme-des-chenes', producerName: 'Ferme des Chênes', name: 'Rôti de bœuf Charolais', price: 24.9, unit: 'kg', qty: 2, slot: 'Samedi 25 avril · 10h–12h' },
  { id: 'gigot', producerSlug: 'agneaux-berce', producerName: 'Agneaux de la Forêt', name: "Gigot d'agneau de pré", price: 28, unit: 'kg', qty: 1.75, slot: 'Mercredi 29 avril · 17h–19h' },
];

export default function PanierPage() {
  const [items, setItems] = useState<Item[]>(INITIAL);

  const byProducer = useMemo(() => {
    const map: Record<string, { name: string; slug: string; items: Item[] }> = {};
    items.forEach((i) => {
      if (!map[i.producerSlug]) map[i.producerSlug] = { name: i.producerName, slug: i.producerSlug, items: [] };
      map[i.producerSlug].items.push(i);
    });
    return Object.values(map);
  }, [items]);

  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);

  const updateQty = (id: string, delta: number) =>
    setItems((arr) => arr.map((i) => i.id === id ? { ...i, qty: Math.max(0.25, Number((i.qty + delta).toFixed(2))) } : i));
  const remove = (id: string) => setItems((arr) => arr.filter((i) => i.id !== id));

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-bg">
        <NavbarPublic />
        <section className="max-w-2xl mx-auto px-6 py-32 text-center">
          <h1 className="font-serif text-[44px] text-green-900">Votre panier est vide</h1>
          <p className="mt-3 text-[16px] text-dark/70">Découvrez les éleveurs sarthois près de chez vous.</p>
          <div className="mt-8"><Link href="/carte"><Button size="lg">Trouver un producteur →</Button></Link></div>
        </section>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg">
      <NavbarPublic />
      <section className="max-w-7xl mx-auto px-6 py-10">
        <h1 className="font-serif text-[40px] md:text-[52px] text-green-900 leading-tight">Votre panier</h1>
        <p className="text-[14px] text-dark/60 mt-1">{items.length} article{items.length > 1 ? 's' : ''} chez {byProducer.length} producteur{byProducer.length > 1 ? 's' : ''}</p>

        <div className="mt-10 grid lg:grid-cols-[1fr_380px] gap-10 items-start">
          <div className="space-y-6">
            {byProducer.map((p) => (
              <section key={p.slug} className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft overflow-hidden">
                <header className="px-5 py-4 border-b border-dark/[0.06] flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.14em] text-terra-700 font-semibold">Commande chez</div>
                    <Link href={`/producteurs/${p.slug}`} className="font-serif text-[22px] text-green-900 hover:text-green-700">{p.name}</Link>
                  </div>
                  <Badge>{p.items.length} article{p.items.length > 1 ? 's' : ''}</Badge>
                </header>
                <ul className="divide-y divide-dark/[0.06]">
                  {p.items.map((it) => (
                    <li key={it.id} className="p-5 flex items-start gap-4">
                      <div className="w-20 h-20 rounded-xl flex-shrink-0 flex items-center justify-center text-green-900/30 font-mono text-[9px] uppercase"
                           style={{ backgroundImage: 'repeating-linear-gradient(45deg, #D8F3DC 0 10px, #C9EAD0 10px 20px)' }}>Photo</div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-serif text-[18px] text-green-900 leading-tight">{it.name}</h3>
                        <div className="text-[12px] text-dark/60 mt-0.5 mono">Retrait · {it.slot}</div>
                        <div className="mt-3 flex items-center gap-3 flex-wrap">
                          <div className="inline-flex items-stretch rounded-lg border border-dark/10 bg-white">
                            <button onClick={() => updateQty(it.id, -0.25)} className="w-9 h-9 text-green-900 hover:bg-green-100">−</button>
                            <div className="w-16 h-9 flex items-center justify-center text-[13px] font-semibold tabular-nums border-x border-dark/10">{it.qty.toFixed(2)} {it.unit}</div>
                            <button onClick={() => updateQty(it.id, 0.25)} className="w-9 h-9 text-green-900 hover:bg-green-100">+</button>
                          </div>
                          <button onClick={() => remove(it.id)} className="text-[13px] text-dark/50 hover:text-terra-700 underline">Retirer</button>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="font-serif text-[20px] text-green-900 tabular-nums">{(it.price * it.qty).toFixed(2).replace('.', ',')} €</div>
                        <div className="text-[12px] text-dark/50 mono">{it.price.toFixed(2).replace('.', ',')} € / {it.unit}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <aside className="lg:sticky lg:top-24 bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
            <h2 className="font-serif text-[24px] text-green-900">Récapitulatif</h2>
            <dl className="mt-5 space-y-3 text-[14px]">
              <div className="flex justify-between"><dt className="text-dark/70">Sous-total</dt><dd className="tabular-nums">{subtotal.toFixed(2).replace('.', ',')} €</dd></div>
              <div className="flex justify-between text-dark/55"><dt>Commission TerrOir (6%)</dt><dd className="mono">incluse</dd></div>
              <div className="flex justify-between text-dark/55"><dt>Retrait à la ferme</dt><dd className="mono">gratuit</dd></div>
            </dl>
            <div className="border-t border-dark/[0.08] mt-5 pt-5 flex items-baseline justify-between">
              <span className="font-serif text-[20px] text-green-900">Total</span>
              <span className="font-serif text-[32px] text-green-900 tabular-nums">{subtotal.toFixed(2).replace('.', ',')} €</span>
            </div>
            <Link href="/compte/checkout"><Button size="lg" className="w-full mt-6">Commander →</Button></Link>
            <p className="text-[11px] text-dark/50 text-center mt-3">Paiement sécurisé · Remboursement garanti</p>
          </aside>
        </div>
      </section>
      <Footer />
    </div>
  );
}
