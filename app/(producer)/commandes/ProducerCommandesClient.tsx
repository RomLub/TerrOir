'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, OrderStatusBadge, type OrderStatus } from '@/components/ui';
import { ListingHeader } from '@/components/listings/ListingHeader';
import { buildCursorUrl } from '@/lib/pagination/cursor';
import { ProducerLayout } from '../_components/ProducerLayout';

export type ProducerOrderRow = {
  id: string;
  code_commande: string | null;
  created_at: string;
  status: OrderStatus;
  client_name: string;
  total: number;
  items: { name: string; qty: string }[];
  slotDate: string;
  slotTime: string;
};

type Tab = 'pending' | 'confirmed' | 'completed' | 'cancelled';
const TABS: { value: Tab; label: string; statuses: OrderStatus[] }[] = [
  { value: 'pending', label: 'À confirmer', statuses: ['pending'] },
  { value: 'confirmed', label: 'Confirmées', statuses: ['confirmed', 'ready'] },
  { value: 'completed', label: 'Terminées', statuses: ['completed'] },
  { value: 'cancelled', label: 'Annulées', statuses: ['cancelled', 'refunded'] },
];

function formatReceived(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) +
    ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export type ProducerCommandesClientProps = {
  initialOrders: ProducerOrderRow[];
  initialTotal: number;
  initialNextCursor: { created_at: string; id: string } | null;
  isPaginated: boolean;
};

export function ProducerCommandesClient({
  initialOrders,
  initialTotal,
  initialNextCursor,
  isPaginated,
}: ProducerCommandesClientProps) {
  const [tab, setTab] = useState<Tab>('pending');
  const [orders, setOrders] = useState<ProducerOrderRow[]>(initialOrders);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  const counts = useMemo(() => {
    const counts: Record<Tab, number> = { pending: 0, confirmed: 0, completed: 0, cancelled: 0 };
    orders.forEach((o) => {
      TABS.forEach((t) => { if (t.statuses.includes(o.status)) counts[t.value]++; });
    });
    return counts;
  }, [orders]);

  const activeStatuses = TABS.find((t) => t.value === tab)!.statuses;
  const filtered = orders.filter((o) => activeStatuses.includes(o.status));

  const actOnOrder = async (id: string, action: 'confirm' | 'cancel') => {
    setWorking(id);
    try {
      const res = await fetch(`/api/orders/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: action === 'cancel' ? JSON.stringify({ reason: 'producer_cancel' }) : undefined,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Action ${action} échouée`);
        return;
      }
      const newStatus: OrderStatus = action === 'confirm' ? 'confirmed' : 'cancelled';
      setOrders((arr) => arr.map((o) => o.id === id ? { ...o, status: newStatus } : o));
    } finally {
      setWorking(null);
    }
  };

  return (
    <ProducerLayout>
      <div className="max-w-6xl mx-auto px-8 py-10">
        <header className="mb-8">
          <div className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold">Commandes</div>
          <h1 className="mt-1 font-serif text-[40px] text-green-900 leading-tight">Vos commandes</h1>
          <div className="mt-1">
            <ListingHeader displayed={orders.length} total={initialTotal} label="commandes" isPaginated={isPaginated} />
          </div>
          {error && <p className="mt-2 text-[13px] text-terra-700">{error}</p>}
        </header>

        <div className="flex gap-1.5 flex-wrap border-b border-dark/[0.08]">
          {TABS.map((t) => {
            const active = tab === t.value;
            return (
              <button key={t.value} onClick={() => setTab(t.value)}
                className={`px-4 py-3 text-[14px] font-medium transition-colors border-b-2 -mb-px flex items-center gap-2 ${
                  active ? 'border-green-700 text-green-900' : 'border-transparent text-dark/60 hover:text-green-900'
                }`}>
                {t.label}
                <span className={`text-[11px] mono px-1.5 rounded ${active ? 'bg-green-100 text-green-900' : 'bg-dark/5 text-dark/55'}`}>{counts[t.value]}</span>
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
                    {o.code_commande && <><span>{o.code_commande}</span><span>·</span></>}
                    <span>Reçu {formatReceived(o.created_at)}</span>
                  </div>
                  <div className="mt-1 flex items-baseline gap-3 flex-wrap">
                    <span className="font-serif text-[22px] text-green-900">{o.client_name}</span>
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
                    <Button variant="ghost" size="sm" disabled={working === o.id} onClick={() => actOnOrder(o.id, 'cancel')}>
                      Annuler
                    </Button>
                    <Button variant="success" size="sm" disabled={working === o.id} onClick={() => actOnOrder(o.id, 'confirm')}>
                      {working === o.id ? '…' : 'Confirmer la commande'}
                    </Button>
                  </>
                )}
                {(o.status === 'confirmed' || o.status === 'ready') && (
                  <Link href={`/commandes/${o.id}`}><Button variant="accent" size="sm">Voir le détail</Button></Link>
                )}
                {(o.status === 'completed' || o.status === 'cancelled' || o.status === 'refunded') && (
                  <Link href={`/commandes/${o.id}`}><Button variant="ghost" size="sm">Voir le détail</Button></Link>
                )}
              </div>
            </article>
          ))}
        </div>
        {initialNextCursor && (
          <div className="mt-6 flex justify-center">
            <Link
              href={buildCursorUrl('/commandes', initialNextCursor)}
              className="text-[14px] font-medium text-green-900 underline hover:text-green-700"
            >
              Charger les 100 plus anciennes
            </Link>
          </div>
        )}
      </div>
    </ProducerLayout>
  );
}
