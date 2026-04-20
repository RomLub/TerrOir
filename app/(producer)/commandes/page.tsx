'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button, OrderStatusBadge } from '@/components/ui';
import { ProducerLayout } from '../_components/ProducerLayout';

type Status = 'pending' | 'confirmed' | 'ready' | 'completed' | 'cancelled';
type Order = { id: string; client: string; date: string; slotDate: string; slotTime: string; items: { name: string; qty: string }[]; total: number; status: Status };

const ORDERS: Order[] = [
  { id: 'TRO-8K2M1P', client: 'Camille', date: '20 avr. 14h32', slotDate: '25 avril', slotTime: '10h–12h', items: [{ name: 'Colis découverte 5 kg', qty: '1' }], total: 89.00, status: 'pending' },
  { id: 'TRO-3X7V5L', client: 'Thomas', date: '19 avr. 21h08', slotDate: '29 avril', slotTime: '17h–19h', items: [{ name: 'Entrecôte maturée', qty: '2,5 kg' }, { name: 'Bourguignon', qty: '1 kg' }], total: 106.15, status: 'pending' },
  { id: 'TRO-7A9K2X', client: 'Marie', date: '20 avr. 10h15', slotDate: '25 avril', slotTime: '10h–12h', items: [{ name: 'Entrecôte maturée', qty: '1,5 kg' }, { name: 'Rôti', qty: '2 kg' }], total: 101.55, status: 'confirmed' },
  { id: 'TRO-5B1N7Q', client: 'Antoine', date: '18 avr. 09h42', slotDate: '22 avril', slotTime: '17h–19h', items: [{ name: 'Merguez maison', qty: '2 kg' }], total: 37.00, status: 'ready' },
  { id: 'TRO-9X3V1B', client: 'Sophie', date: '2 avr.', slotDate: '5 avril', slotTime: '10h–12h', items: [{ name: 'Gigot agneau', qty: '2 kg' }], total: 56.00, status: 'completed' },
  { id: 'TRO-2K9L5F', client: 'Hélène', date: '5 mars', slotDate: '8 mars', slotTime: '10h–12h', items: [{ name: 'Colis découverte', qty: '1' }], total: 89.00, status: 'cancelled' },
];

type Tab = 'pending' | 'confirmed' | 'completed' | 'cancelled';
const TABS: { value: Tab; label: string; statuses: Status[] }[] = [
  { value: 'pending', label: 'À confirmer', statuses: ['pending'] },
  { value: 'confirmed', label: 'Confirmées', statuses: ['confirmed', 'ready'] },
  { value: 'completed', label: 'Terminées', statuses: ['completed'] },
  { value: 'cancelled', label: 'Annulées', statuses: ['cancelled'] },
];

export default function ProducerCommandesPage() {
  const [tab, setTab] = useState<Tab>('pending');
  const [validating, setValidating] = useState<Order | null>(null);
  const [orders, setOrders] = useState(ORDERS);

  const activeStatuses = TABS.find((t) => t.value === tab)!.statuses;
  const filtered = orders.filter((o) => activeStatuses.includes(o.status));
  const setStatus = (id: string, status: Status) =>
    setOrders((arr) => arr.map((o) => o.id === id ? { ...o, status } : o));

  return (
    <ProducerLayout>
      <div className="max-w-6xl mx-auto px-8 py-10">
        <header className="mb-8">
          <div className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold">Commandes</div>
          <h1 className="mt-1 font-serif text-[40px] text-green-900 leading-tight">Vos commandes</h1>
        </header>

        <div className="flex gap-1.5 flex-wrap border-b border-dark/[0.08]">
          {TABS.map((t) => {
            const count = orders.filter((o) => t.statuses.includes(o.status)).length;
            const active = tab === t.value;
            return (
              <button key={t.value} onClick={() => setTab(t.value)}
                className={`px-4 py-3 text-[14px] font-medium transition-colors border-b-2 -mb-px flex items-center gap-2 ${
                  active ? 'border-green-700 text-green-900' : 'border-transparent text-dark/60 hover:text-green-900'
                }`}>
                {t.label}
                <span className={`text-[11px] mono px-1.5 rounded ${active ? 'bg-green-100 text-green-900' : 'bg-dark/5 text-dark/55'}`}>{count}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-6 space-y-3">
          {filtered.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dark/[0.06] p-10 text-center">
              <h3 className="font-serif text-[22px] text-green-900">Aucune commande</h3>
            </div>
          ) : filtered.map((o) => (
            <article key={o.id} className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-5">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-[12px] mono text-dark/50">
                    <span>{o.id}</span><span>·</span><span>Reçu {o.date}</span>
                  </div>
                  <div className="mt-1 flex items-baseline gap-3 flex-wrap">
                    <span className="font-serif text-[22px] text-green-900">{o.client}</span>
                    <span className="text-[13px] text-dark/70">Retrait le {o.slotDate} · {o.slotTime}</span>
                  </div>
                  <ul className="mt-2 text-[13px] text-dark/70 space-y-0.5">
                    {o.items.map((it, i) => <li key={i}>• {it.name} — <span className="mono">{it.qty}</span></li>)}
                  </ul>
                </div>
                <div className="flex items-center gap-4">
                  <OrderStatusBadge status={o.status} />
                  <div className="font-serif text-[22px] text-green-900 tabular-nums">{o.total.toFixed(2).replace('.', ',')} €</div>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-dark/[0.06] flex gap-2 flex-wrap justify-end">
                {o.status === 'pending' && (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => setStatus(o.id, 'cancelled')}>Annuler</Button>
                    <Button size="sm" onClick={() => setStatus(o.id, 'confirmed')}>Confirmer la commande</Button>
                  </>
                )}
                {o.status === 'confirmed' && (
                  <Button size="sm" onClick={() => setStatus(o.id, 'ready')}>Marquer comme prête</Button>
                )}
                {o.status === 'ready' && (
                  <Button size="sm" onClick={() => setValidating(o)}>Valider le retrait</Button>
                )}
                {(o.status === 'completed' || o.status === 'cancelled') && (
                  <Link href={`/commandes/${o.id}`}><Button variant="ghost" size="sm">Voir le détail</Button></Link>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>

      {validating && (
        <ValidateCodeModal order={validating} onClose={() => setValidating(null)}
          onSuccess={() => { setStatus(validating.id, 'completed'); setValidating(null); }} />
      )}
    </ProducerLayout>
  );
}

function ValidateCodeModal({ order, onClose, onSuccess }: { order: Order; onClose: () => void; onSuccess: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const expected = order.id.replace('TRO-', '');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = code.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    if (clean === expected) { setSuccess(true); setTimeout(onSuccess, 1400); }
    else setError('Code invalide, vérifiez avec votre client.');
  };

  return (
    <div className="fixed inset-0 z-50 bg-green-900/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-card w-full max-w-md p-8 text-center" onClick={(e) => e.stopPropagation()}>
        {success ? (
          <div>
            <div className="w-20 h-20 mx-auto rounded-full bg-green-100 border-2 border-green-700 flex items-center justify-center">
              <svg width="44" height="44" viewBox="0 0 48 48" className="text-green-700">
                <path d="M12 24 L20 32 L36 16" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h2 className="mt-5 font-serif text-[28px] text-green-900">Retrait validé</h2>
            <p className="mt-2 text-[14px] text-dark/70">La commande est marquée comme terminée.</p>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="text-[11px] uppercase tracking-[0.2em] text-terra-700 font-semibold">Validation retrait</div>
            <h2 className="mt-2 font-serif text-[28px] text-green-900 leading-tight">Saisissez le code de {order.client}</h2>
            <p className="mt-2 text-[13px] text-dark/60">Demandez à votre client le code affiché sur sa commande.</p>
            <div className="mt-6">
              <input value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(null); }}
                maxLength={10} placeholder="XXXXXX" autoFocus
                className={`w-full text-center font-mono text-[36px] tracking-[0.3em] h-20 rounded-xl border-2 uppercase outline-none ${
                  error ? 'border-terra-700 bg-terra-100/30' : 'border-dark/10 focus:border-green-700 bg-bg'
                }`} />
              {error && <p className="mt-2 text-[13px] text-terra-700">{error}</p>}
            </div>
            <div className="mt-6 flex gap-2 justify-end">
              <Button type="button" variant="ghost" onClick={onClose}>Annuler</Button>
              <Button type="submit" disabled={code.length < 6}>Valider</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
