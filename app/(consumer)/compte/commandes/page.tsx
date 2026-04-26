'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { OrderStatusBadge, type OrderStatus } from '@/components/ui';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

type OrderRow = {
  id: string;
  code_commande: string | null;
  created_at: string;
  statut: OrderStatus;
  cancellation_reason: string | null;
  montant_total: number;
  producer_id: string;
  producer_name: string;
  producer_slug: string;
  item_count: number;
};

// Une commande annulée par échec de paiement (3DS-fail, fonds insuffisants…)
// n'a jamais été engagée du point de vue consumer : pas d'argent débité, pas
// de produit réservé. Filtre côté front pour ne pas polluer l'historique
// (cf bug P2 commit 9482e5b qui pose cancellation_reason='payment_failed').
function isPaymentFailedRow(o: { statut: OrderStatus; cancellation_reason: string | null }): boolean {
  return o.statut === 'cancelled' && o.cancellation_reason === 'payment_failed';
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

export default function CommandesPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let channel: RealtimeChannel | null = null;
    let active = true;

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (active) { setLoading(false); setError('Vous devez être connecté.'); }
        return;
      }

      const { data, error: fetchError } = await supabase
        .from('orders')
        .select(`
          id, code_commande, created_at, statut, cancellation_reason, montant_total, producer_id,
          producers:producer_id ( nom_exploitation, slug ),
          order_items ( id )
        `)
        .eq('consumer_id', user.id)
        .order('created_at', { ascending: false });

      if (!active) return;

      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      const rows: OrderRow[] = (data ?? [])
        .map((o) => {
          const prod = Array.isArray(o.producers) ? o.producers[0] : o.producers;
          const itemsArr = Array.isArray(o.order_items) ? o.order_items : [];
          return {
            id: o.id as string,
            code_commande: (o.code_commande as string | null) ?? null,
            created_at: o.created_at as string,
            statut: o.statut as OrderStatus,
            cancellation_reason: (o.cancellation_reason as string | null) ?? null,
            montant_total: Number(o.montant_total ?? 0),
            producer_id: o.producer_id as string,
            producer_name: prod?.nom_exploitation ?? 'Producteur',
            producer_slug: prod?.slug ?? '',
            item_count: itemsArr.length,
          };
        })
        .filter((r) => !isPaymentFailedRow(r));

      setOrders(rows);
      setLoading(false);

      channel = supabase
        .channel(`orders-consumer-${user.id}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'orders', filter: `consumer_id=eq.${user.id}` },
          (payload) => {
            const updated = payload.new as {
              id: string;
              statut: OrderStatus;
              cancellation_reason: string | null;
            };
            // Si la commande visible bascule en payment_failed (UPDATE webhook
            // 3DS-fail en temps réel), on la retire du state — du point de
            // vue consumer elle n'a jamais été engagée. Sinon merge classique.
            setOrders((prev) => {
              if (isPaymentFailedRow(updated)) {
                return prev.filter((o) => o.id !== updated.id);
              }
              return prev.map((o) =>
                o.id === updated.id
                  ? { ...o, statut: updated.statut, cancellation_reason: updated.cancellation_reason }
                  : o,
              );
            });
          },
        )
        .subscribe();
    })();

    return () => {
      active = false;
      if (channel) {
        const supabase = createSupabaseBrowserClient();
        supabase.removeChannel(channel);
      }
    };
  }, []);

  const filtered = useMemo(() => orders.filter((o) => {
    if (filter === 'all') return true;
    if (filter === 'active') return o.statut === 'pending' || o.statut === 'confirmed' || o.statut === 'ready';
    if (filter === 'done') return o.statut === 'completed';
    if (filter === 'cancelled') return o.statut === 'cancelled' || o.statut === 'refunded';
    return true;
  }), [orders, filter]);

  return (
    <section>
      <h1 className="font-serif text-[40px] md:text-[52px] text-green-900 leading-tight">Mes commandes</h1>
        <p className="text-[14px] text-dark/60 mt-1">
          {loading ? 'Chargement…' : `${orders.length} commande${orders.length > 1 ? 's' : ''} au total`}
        </p>
        {error && <p className="mt-2 text-[13px] text-terra-700">{error}</p>}

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
          {!loading && filtered.length === 0 ? (
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
                  <div className="flex items-center gap-2 text-[12px] mono text-dark/50">
                    {o.code_commande && <><span>{o.code_commande}</span><span>·</span></>}
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
    </section>
  );
}
