'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Button, OrderStatusBadge, type OrderStatus } from '@/components/ui';
import { ProducerLayout } from '../../_components/ProducerLayout';

type OrderItem = { name: string; qty: string; unitPrice: number; total: number };
type Order = {
  id: string;
  client: { name: string; email: string; phone: string };
  date: string;
  slotDate: string;
  slotTime: string;
  items: OrderItem[];
  subtotal: number;
  commission: number;
  total: number;
  status: OrderStatus;
  note?: string;
};

const ORDERS: Record<string, Order> = {
  'TRO-8K2M1P': {
    id: 'TRO-8K2M1P',
    client: { name: 'Camille Rousseau', email: 'camille.r@exemple.fr', phone: '06 12 34 56 78' },
    date: '20 avril 2026 à 14h32',
    slotDate: 'Samedi 25 avril 2026',
    slotTime: '10h – 12h',
    items: [{ name: 'Colis découverte 5 kg', qty: '1 colis', unitPrice: 89, total: 89 }],
    subtotal: 89,
    commission: 5.34,
    total: 89,
    status: 'pending',
    note: 'Je passerai avec ma fille, merci !',
  },
  'TRO-7A9K2X': {
    id: 'TRO-7A9K2X',
    client: { name: 'Marie Dubois', email: 'marie.dubois@exemple.fr', phone: '06 98 76 54 32' },
    date: '20 avril 2026 à 10h15',
    slotDate: 'Samedi 25 avril 2026',
    slotTime: '10h – 12h',
    items: [
      { name: 'Entrecôte maturée 21 jours', qty: '1,5 kg', unitPrice: 34.5, total: 51.75 },
      { name: 'Rôti de bœuf Charolais', qty: '2 kg', unitPrice: 24.9, total: 49.8 },
    ],
    subtotal: 101.55,
    commission: 6.09,
    total: 101.55,
    status: 'confirmed',
  },
  'TRO-5B1N7Q': {
    id: 'TRO-5B1N7Q',
    client: { name: 'Antoine Martin', email: 'antoine.m@exemple.fr', phone: '06 45 67 89 01' },
    date: '18 avril 2026 à 09h42',
    slotDate: 'Mardi 22 avril 2026',
    slotTime: '17h – 19h',
    items: [{ name: 'Merguez maison', qty: '2 kg', unitPrice: 18.5, total: 37 }],
    subtotal: 37,
    commission: 2.22,
    total: 37,
    status: 'ready',
  },
};

const FALLBACK: Order = {
  id: 'TRO-XXXXXX',
  client: { name: 'Client', email: '—', phone: '—' },
  date: '—',
  slotDate: '—',
  slotTime: '—',
  items: [],
  subtotal: 0,
  commission: 0,
  total: 0,
  status: 'pending',
};

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const orderId = params?.id ?? '';
  const initial = ORDERS[orderId] ?? { ...FALLBACK, id: orderId || FALLBACK.id };

  const [order, setOrder] = useState<Order>(initial);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeSuccess, setCodeSuccess] = useState(false);

  const expected = order.id.replace('TRO-', '');

  const submitCode = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = code.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    if (clean.length !== 6) {
      setCodeError('Le code doit contenir 6 caractères.');
      return;
    }
    if (clean === expected) {
      setCodeSuccess(true);
      setCodeError(null);
      setTimeout(() => setOrder((o) => ({ ...o, status: 'completed' })), 1400);
    } else {
      setCodeError('Code invalide');
    }
  };

  const confirm = () => setOrder((o) => ({ ...o, status: 'confirmed' }));
  const cancel = () => setOrder((o) => ({ ...o, status: 'cancelled' }));
  const markReady = () => setOrder((o) => ({ ...o, status: 'ready' }));

  const canValidateCode = order.status === 'ready';

  return (
    <ProducerLayout>
      <div className="max-w-5xl mx-auto px-8 py-10">
        <header className="mb-8">
          <Link href="/commandes" className="text-[13px] text-dark/60 hover:text-green-900">← Retour aux commandes</Link>
          <div className="mt-3 flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold mono">{order.id}</div>
              <h1 className="mt-1 font-serif text-[40px] text-green-900 leading-tight">Commande de {order.client.name.split(' ')[0]}</h1>
              <p className="text-[13px] text-dark/60 mt-1">Reçue le {order.date}</p>
            </div>
            <OrderStatusBadge status={order.status} />
          </div>
        </header>

        <div className="grid lg:grid-cols-[1fr_360px] gap-8 items-start">
          <div className="space-y-6">
            <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
              <h2 className="font-serif text-[22px] text-green-900 mb-4">Détail du retrait</h2>
              <dl className="grid sm:grid-cols-2 gap-4 text-[14px]">
                <div>
                  <dt className="text-[11px] uppercase tracking-[0.14em] text-dark/50 font-semibold">Date</dt>
                  <dd className="mt-1 text-dark/80">{order.slotDate}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-[0.14em] text-dark/50 font-semibold">Créneau</dt>
                  <dd className="mt-1 text-dark/80">{order.slotTime}</dd>
                </div>
              </dl>
              {order.note && (
                <div className="mt-4 pt-4 border-t border-dark/[0.06]">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-dark/50 font-semibold">Note du client</div>
                  <p className="mt-1 text-[14px] text-dark/80 italic">« {order.note} »</p>
                </div>
              )}
            </section>

            <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
              <h2 className="font-serif text-[22px] text-green-900 mb-4">Articles</h2>
              {order.items.length === 0 ? (
                <p className="text-[13px] text-dark/55">Aucun article dans cette commande.</p>
              ) : (
                <ul className="divide-y divide-dark/[0.06]">
                  {order.items.map((it, i) => (
                    <li key={i} className="py-3 flex items-baseline justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="text-[15px] text-green-900 font-medium">{it.name}</div>
                        <div className="text-[12px] mono text-dark/55 mt-0.5">{it.qty} · {it.unitPrice.toFixed(2).replace('.', ',')} € / unité</div>
                      </div>
                      <div className="font-serif text-[18px] text-green-900 tabular-nums">{it.total.toFixed(2).replace('.', ',')} €</div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4 pt-4 border-t border-dark/[0.08] space-y-1.5 text-[14px]">
                <div className="flex justify-between text-dark/65">
                  <span>Sous-total</span><span className="tabular-nums">{order.subtotal.toFixed(2).replace('.', ',')} €</span>
                </div>
                <div className="flex justify-between text-dark/65">
                  <span>Commission TerrOir (6%)</span><span className="tabular-nums">−{order.commission.toFixed(2).replace('.', ',')} €</span>
                </div>
                <div className="flex justify-between pt-2 mt-2 border-t border-dark/[0.06]">
                  <span className="font-serif text-[18px] text-green-900">Net producteur</span>
                  <span className="font-serif text-[22px] text-green-900 tabular-nums">{(order.subtotal - order.commission).toFixed(2).replace('.', ',')} €</span>
                </div>
              </div>
            </section>

            {canValidateCode && (
              <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
                <h2 className="font-serif text-[22px] text-green-900 mb-1">Validation du retrait</h2>
                <p className="text-[13px] text-dark/60 mb-5">Demandez à {order.client.name.split(' ')[0]} le code à 6 caractères affiché sur sa commande.</p>

                {codeSuccess ? (
                  <div className="text-center py-6 animate-[fadeIn_0.4s_ease-out]">
                    <div className="w-20 h-20 mx-auto rounded-full bg-green-100 border-2 border-green-700 flex items-center justify-center animate-[scaleIn_0.5s_ease-out]">
                      <svg width="44" height="44" viewBox="0 0 48 48" className="text-green-700">
                        <path d="M12 24 L20 32 L36 16" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <h3 className="mt-5 font-serif text-[26px] text-green-900">Retrait validé</h3>
                    <p className="mt-2 text-[14px] text-dark/70">La commande est marquée comme terminée.</p>
                  </div>
                ) : (
                  <form onSubmit={submitCode}>
                    <input
                      value={code}
                      onChange={(e) => { setCode(e.target.value.toUpperCase().slice(0, 6)); setCodeError(null); }}
                      maxLength={6}
                      placeholder="XXXXXX"
                      autoFocus
                      aria-label="Code de commande"
                      className={`w-full text-center font-mono text-[44px] tracking-[0.35em] h-24 rounded-xl border-2 uppercase outline-none transition-colors ${
                        codeError ? 'border-terra-700 bg-terra-100/30 animate-[shake_0.4s]' : 'border-dark/10 focus:border-green-700 bg-bg'
                      }`}
                    />
                    {codeError && <p className="mt-3 text-[13px] text-terra-700 font-medium">{codeError}</p>}
                    <div className="mt-5 flex gap-2 justify-end">
                      <Button type="submit" size="lg" disabled={code.length < 6}>Valider le retrait</Button>
                    </div>
                  </form>
                )}
              </section>
            )}
          </div>

          <aside className="space-y-6 lg:sticky lg:top-10">
            <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
              <h2 className="font-serif text-[22px] text-green-900 mb-4">Client</h2>
              <dl className="space-y-3 text-[14px]">
                <div>
                  <dt className="text-[11px] uppercase tracking-[0.14em] text-dark/50 font-semibold">Nom</dt>
                  <dd className="mt-1 text-dark/85">{order.client.name}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-[0.14em] text-dark/50 font-semibold">Email</dt>
                  <dd className="mt-1"><a href={`mailto:${order.client.email}`} className="text-green-700 hover:text-green-900 break-all">{order.client.email}</a></dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-[0.14em] text-dark/50 font-semibold">Téléphone</dt>
                  <dd className="mt-1"><a href={`tel:${order.client.phone.replace(/\s/g, '')}`} className="text-green-700 hover:text-green-900">{order.client.phone}</a></dd>
                </div>
              </dl>
            </section>

            <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
              <h2 className="font-serif text-[18px] text-green-900 mb-4">Actions</h2>
              <div className="flex flex-col gap-2">
                {order.status === 'pending' && (
                  <>
                    <Button size="lg" onClick={confirm}>Confirmer la commande</Button>
                    <Button variant="ghost" size="lg" onClick={cancel}>Annuler</Button>
                  </>
                )}
                {order.status === 'confirmed' && (
                  <>
                    <Button size="lg" onClick={markReady}>Marquer comme prête</Button>
                    <Button variant="ghost" size="lg" onClick={cancel}>Annuler</Button>
                  </>
                )}
                {order.status === 'ready' && (
                  <p className="text-[13px] text-dark/60">Saisissez le code client ci-contre pour finaliser.</p>
                )}
                {order.status === 'completed' && (
                  <p className="text-[13px] text-dark/60">Commande finalisée. Le règlement sera inclus dans le prochain virement.</p>
                )}
                {order.status === 'cancelled' && (
                  <p className="text-[13px] text-dark/60">Cette commande a été annulée.</p>
                )}
              </div>
            </section>
          </aside>
        </div>
      </div>

      <style jsx>{`
        @keyframes scaleIn { from { transform: scale(0.6); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes shake { 0%, 100% { transform: translateX(0); } 20%, 60% { transform: translateX(-6px); } 40%, 80% { transform: translateX(6px); } }
      `}</style>
    </ProducerLayout>
  );
}
