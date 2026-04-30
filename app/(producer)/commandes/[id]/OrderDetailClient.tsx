'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button, OrderStatusBadge, type OrderStatus } from '@/components/ui';
import { canProducerCancel } from '@/lib/orders/stateMachine';

type OrderItem = { name: string; qty: string; unitPrice: number; total: number };
export type OrderDetailData = {
  id: string;
  codeCommande: string | null;
  client: { name: string; email: string; phone: string };
  createdAtLabel: string;
  slotDate: string;
  slotTime: string;
  items: OrderItem[];
  subtotal: number;
  commission: number;
  total: number;
  status: OrderStatus;
  note?: string;
};

export function OrderDetailClient({ data }: { data: OrderDetailData }) {
  const [order, setOrder] = useState(data);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeSuccess, setCodeSuccess] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canValidateCode = order.status === 'ready';

  const call = async (action: 'confirm' | 'cancel', opts?: { reason?: string }) => {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${order.id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: opts?.reason ? JSON.stringify({ reason: opts.reason }) : undefined,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `Action ${action} échouée`);
        return;
      }
      const next: OrderStatus = action === 'confirm' ? 'confirmed' : 'cancelled';
      setOrder((o) => ({ ...o, status: next }));
    } finally {
      setBusy(null);
    }
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setCodeError(null);
    const clean = code.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    if (clean.length < 5) {
      setCodeError('Code trop court.');
      return;
    }
    setBusy('complete');
    try {
      const res = await fetch(`/api/orders/${order.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code_commande: clean }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCodeError(body.error ?? 'Code invalide');
        return;
      }
      setCodeSuccess(true);
      setTimeout(() => setOrder((o) => ({ ...o, status: 'completed' })), 1200);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-8 py-10">
      <header className="mb-8">
        <Link href="/commandes" className="text-[13px] text-dark/60 hover:text-green-900">← Retour aux commandes</Link>
        <div className="mt-3 flex items-start justify-between gap-4 flex-wrap">
          <div>
            {order.codeCommande && (
              <div className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold mono">{order.codeCommande}</div>
            )}
            <h1 className="mt-1 font-serif text-[40px] text-green-900 leading-tight">Commande de {order.client.name.split(' ')[0]}</h1>
            <p className="text-[13px] text-dark/60 mt-1">Reçue le {order.createdAtLabel}</p>
          </div>
          <OrderStatusBadge status={order.status} />
        </div>
        {error && <p className="mt-3 text-[13px] text-terra-700">{error}</p>}
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
              <p className="text-[13px] text-dark/60 mb-5">Demandez à {order.client.name.split(' ')[0]} le code affiché sur sa commande.</p>

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
                    onChange={(e) => { setCode(e.target.value.toUpperCase().slice(0, 12)); setCodeError(null); }}
                    maxLength={12}
                    placeholder="TRR-XXXXX"
                    autoFocus
                    aria-label="Code de commande"
                    className={`w-full text-center font-mono text-[40px] tracking-[0.25em] h-24 rounded-xl border-2 uppercase outline-none transition-colors ${
                      codeError ? 'border-terra-700 bg-terra-100/30 animate-[shake_0.4s]' : 'border-dark/10 focus:border-green-700 bg-bg'
                    }`}
                  />
                  {codeError && <p className="mt-3 text-[13px] text-terra-700 font-medium">{codeError}</p>}
                  <div className="mt-5 flex gap-2 justify-end">
                    <Button type="submit" variant="success" size="lg" disabled={busy === 'complete'}>
                      {busy === 'complete' ? 'Validation…' : 'Valider le retrait'}
                    </Button>
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
              {order.client.email !== '—' && (
                <div>
                  <dt className="text-[11px] uppercase tracking-[0.14em] text-dark/50 font-semibold">Email</dt>
                  <dd className="mt-1"><a href={`mailto:${order.client.email}`} className="text-green-700 hover:text-green-900 break-all">{order.client.email}</a></dd>
                </div>
              )}
              {order.client.phone !== '—' && (
                <div>
                  <dt className="text-[11px] uppercase tracking-[0.14em] text-dark/50 font-semibold">Téléphone</dt>
                  <dd className="mt-1"><a href={`tel:${order.client.phone.replace(/\s/g, '')}`} className="text-green-700 hover:text-green-900">{order.client.phone}</a></dd>
                </div>
              )}
            </dl>
          </section>

          <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
            <h2 className="font-serif text-[18px] text-green-900 mb-4">Actions</h2>
            <div className="flex flex-col gap-2">
              {order.status === 'pending' && (
                <Button variant="success" size="lg" disabled={busy !== null} onClick={() => call('confirm')}>
                  {busy === 'confirm' ? 'Confirmation…' : 'Confirmer la commande'}
                </Button>
              )}
              {order.status === 'confirmed' && (
                <p className="text-[13px] text-dark/60">Préparez la commande puis validez le retrait avec le code client.</p>
              )}
              {order.status === 'ready' && (
                <p className="text-[13px] text-dark/60">Saisissez le code client ci-contre pour finaliser.</p>
              )}
              {canProducerCancel(order.status) && (
                <Button variant="ghost" size="lg" disabled={busy !== null} onClick={() => call('cancel', { reason: 'producer_cancel' })}>
                  Annuler
                </Button>
              )}
              {order.status === 'completed' && (
                <p className="text-[13px] text-dark/60">Commande finalisée. Le règlement sera inclus dans le prochain virement.</p>
              )}
              {(order.status === 'cancelled' || order.status === 'refunded') && (
                <p className="text-[13px] text-dark/60">Cette commande a été annulée.</p>
              )}
            </div>
          </section>
        </aside>
      </div>

      <style jsx>{`
        @keyframes scaleIn { from { transform: scale(0.6); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes shake { 0%, 100% { transform: translateX(0); } 20%, 60% { transform: translateX(-6px); } 40%, 80% { transform: translateX(6px); } }
      `}</style>
    </div>
  );
}
