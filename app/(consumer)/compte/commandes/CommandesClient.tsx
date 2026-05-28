'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type {
  RealtimeChannel,
  RealtimePostgresUpdatePayload,
} from '@supabase/supabase-js';
import { OrderStatusBadge, type OrderStatus } from '@/components/ui';
import { ListingHeader } from '@/components/listings/ListingHeader';
import { buildCursorUrl } from '@/lib/pagination/cursor';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export type OrderRow = {
  id: string;
  code_commande: string | null;
  numero_commande: string;
  created_at: string;
  statut: OrderStatus;
  closure_reason: string | null;
  montant_total: number;
  producer_id: string;
  producer_name: string;
  producer_slug: string;
  item_count: number;
};

// Une commande annulée pour cause de paiement non finalisé n'a jamais été
// engagée du point de vue consumer : pas d'argent débité (ou refundé), pas
// de produit réservé. Filtre côté front pour les UPDATE realtime — le SSR
// applique déjà le même filtre au load initial via isVoidOrderRow.
const VOID_ORDER_REASONS: ReadonlySet<string> = new Set([
  'payment_failed',
  'revival_blocked_stock',
  'revival_blocked_slot',
]);

function isVoidOrderRow(o: { statut: OrderStatus; closure_reason: string | null }): boolean {
  return (
    o.statut === 'cancelled' &&
    o.closure_reason !== null &&
    VOID_ORDER_REASONS.has(o.closure_reason)
  );
}

type Filter = 'all' | 'active' | 'done' | 'cancelled';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Toutes' },
  { value: 'active', label: 'En cours' },
  { value: 'done', label: 'Terminées' },
  { value: 'cancelled', label: 'Annulées' },
];

function formatDateFr(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export type CommandesClientProps = {
  consumerId: string;
  initialOrders: OrderRow[];
  initialTotal: number;
  initialNextCursor: { created_at: string; id: string } | null;
  isPaginated: boolean;
};

export function CommandesClient({
  consumerId,
  initialOrders,
  initialTotal,
  initialNextCursor,
  isPaginated,
}: CommandesClientProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [orders, setOrders] = useState<OrderRow[]>(initialOrders);

  // Realtime UPDATE feed — côté client uniquement, le SSR a livré l'état
  // initial. Audit Vercel C-4 + H-5 : auth.getUser() + Promise.all(orders,
  // count) sont remontés en SSR (page.tsx), supprimant le waterfall client.
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let channel: RealtimeChannel | null = null;

    channel = supabase
      .channel(`orders-consumer-${consumerId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `consumer_id=eq.${consumerId}` },
        (payload: RealtimePostgresUpdatePayload<Record<string, unknown>>) => {
          const updated = payload.new as {
            id: string;
            statut: OrderStatus;
            closure_reason: string | null;
          };
          // Si la commande visible bascule en void (payment_failed,
          // revival_blocked_stock, revival_blocked_slot) — UPDATE webhook en
          // temps réel — on la retire du state. Sinon merge classique.
          setOrders((prev) => {
            if (isVoidOrderRow(updated)) {
              return prev.filter((o) => o.id !== updated.id);
            }
            return prev.map((o) =>
              o.id === updated.id
                ? { ...o, statut: updated.statut, closure_reason: updated.closure_reason }
                : o,
            );
          });
        },
      )
      .subscribe();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [consumerId]);

  const filtered = useMemo(() => orders.filter((o) => {
    if (filter === 'all') return true;
    if (filter === 'active') return o.statut === 'pending' || o.statut === 'confirmed';
    if (filter === 'done') return o.statut === 'completed';
    if (filter === 'cancelled') return o.statut === 'cancelled' || o.statut === 'refunded';
    return true;
  }), [orders, filter]);

  return (
    <section>
      <h1 className="font-serif text-[40px] md:text-[52px] text-green-900 leading-tight">Mes commandes</h1>
      <div className="mt-1">
        <ListingHeader displayed={orders.length} total={initialTotal} label="commandes" isPaginated={isPaginated} />
      </div>

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
        ) : filtered.map((o) => (
          <Link
            key={o.id}
            href={`/compte/commandes/${o.id}`}
            className="block bg-white rounded-2xl border border-dark/[0.06] shadow-soft hover:shadow-card hover:-translate-y-0.5 transition-all p-5"
          >
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-[12px] text-dark/50">
                  <span>{o.numero_commande}</span><span>·</span>
                  <span>{formatDateFr(o.created_at)}</span>
                </div>
                <div className="mt-1 font-serif text-[22px] text-green-900 leading-tight">{o.producer_name}</div>
                <div className="text-[13px] text-dark/60 mt-0.5">{o.item_count} article{o.item_count > 1 ? 's' : ''}</div>
              </div>
              <div className="flex items-center gap-5">
                <OrderStatusBadge status={o.statut} />
                <div className="text-right">
                  <div className="font-serif text-[22px] text-green-900 tabular-nums">{o.montant_total.toFixed(2).replace('.', ',')} €</div>
                </div>
                <span className="text-dark/30 text-xl">›</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
      {initialNextCursor && (
        <div className="mt-6 flex justify-center">
          <Link
            href={buildCursorUrl('/compte/commandes', initialNextCursor)}
            className="text-[14px] font-medium text-green-900 underline hover:text-green-700"
          >
            Charger les 100 plus anciennes
          </Link>
        </div>
      )}
    </section>
  );
}
