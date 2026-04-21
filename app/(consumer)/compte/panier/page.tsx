'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Button, Badge } from '@/components/ui';
import { useCartStore, type CartItem } from '@/lib/store/cart';

function formatDateFr(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

export default function PanierPage() {
  const items = useCartStore((s) => s.items);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);

  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  const byProducer = useMemo(() => {
    const map: Record<string, { name: string; slug: string; producerId: string; items: CartItem[] }> = {};
    items.forEach((i) => {
      if (!map[i.producerId]) {
        map[i.producerId] = {
          name: i.producerName ?? 'Producteur',
          slug: i.slug,
          producerId: i.producerId,
          items: [],
        };
      }
      map[i.producerId].items.push(i);
    });
    return Object.values(map);
  }, [items]);

  const subtotal = items.reduce((s, i) => s + i.prix * i.quantite, 0);

  const step = (unite: string) => (unite === 'kg' ? 0.25 : 1);

  if (!hydrated) {
    return (
      <section className="py-24 text-center text-dark/50">
        Chargement du panier…
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section className="py-24 text-center">
        <h1 className="font-serif text-[44px] text-green-900">Votre panier est vide</h1>
        <p className="mt-3 text-[16px] text-dark/70">Découvrez les éleveurs sarthois près de chez vous.</p>
        <div className="mt-8"><Link href="/carte"><Button size="lg">Trouver un producteur →</Button></Link></div>
      </section>
    );
  }

  return (
    <section>
      <h1 className="font-serif text-[40px] md:text-[52px] text-green-900 leading-tight">Votre panier</h1>
        <p className="text-[14px] text-dark/60 mt-1">{items.length} article{items.length > 1 ? 's' : ''} chez {byProducer.length} producteur{byProducer.length > 1 ? 's' : ''}</p>

        <div className="mt-10 grid lg:grid-cols-[1fr_380px] gap-10 items-start">
          <div className="space-y-6">
            {byProducer.map((p) => (
              <section key={p.producerId} className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft overflow-hidden">
                <header className="px-5 py-4 border-b border-dark/[0.06] flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.14em] text-terra-700 font-semibold">Commande chez</div>
                    <Link href={`/producteurs/${p.slug}`} className="font-serif text-[22px] text-green-900 hover:text-green-700">{p.name}</Link>
                  </div>
                  <Badge>{p.items.length} article{p.items.length > 1 ? 's' : ''}</Badge>
                </header>
                <ul className="divide-y divide-dark/[0.06]">
                  {p.items.map((it) => {
                    const key = { productId: it.productId, creneauId: it.creneauId, dateRetrait: it.dateRetrait };
                    const s = step(it.unite);
                    return (
                      <li key={`${it.productId}-${it.creneauId}-${it.dateRetrait}`} className="p-5 flex items-start gap-4">
                        <div className="w-20 h-20 rounded-xl flex-shrink-0 overflow-hidden"
                             style={!it.image ? { backgroundImage: 'repeating-linear-gradient(45deg, #D8F3DC 0 10px, #C9EAD0 10px 20px)' } : undefined}>
                          {it.image && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={it.image} alt="" className="w-full h-full object-cover" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-serif text-[18px] text-green-900 leading-tight">{it.nom}</h3>
                          <div className="text-[12px] text-dark/60 mt-0.5 mono">Retrait · {formatDateFr(it.dateRetrait)}</div>
                          <div className="mt-3 flex items-center gap-3 flex-wrap">
                            <div className="inline-flex items-stretch rounded-lg border border-dark/10 bg-white">
                              <button type="button"
                                onClick={() => updateQuantity(key, Number((it.quantite - s).toFixed(2)))}
                                className="w-9 h-9 text-green-900 hover:bg-green-100 disabled:opacity-30"
                                disabled={it.quantite <= s}>−</button>
                              <div className="w-20 h-9 flex items-center justify-center text-[13px] font-semibold tabular-nums border-x border-dark/10">
                                {it.quantite.toFixed(2).replace('.', ',')} {it.unite}
                              </div>
                              <button type="button"
                                onClick={() => updateQuantity(key, Number((it.quantite + s).toFixed(2)))}
                                className="w-9 h-9 text-green-900 hover:bg-green-100">+</button>
                            </div>
                            <button type="button" onClick={() => removeItem(key)}
                              className="text-[13px] text-dark/50 hover:text-terra-700 underline">Retirer</button>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="font-serif text-[20px] text-green-900 tabular-nums">{(it.prix * it.quantite).toFixed(2).replace('.', ',')} €</div>
                          <div className="text-[12px] text-dark/50 mono">{it.prix.toFixed(2).replace('.', ',')} € / {it.unite}</div>
                        </div>
                      </li>
                    );
                  })}
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
  );
}
