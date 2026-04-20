'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, OrderStatusBadge, type OrderStatus } from '@/components/ui';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { ProducerLayout } from '../_components/ProducerLayout';

type OrderRow = {
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

function formatRangeShort(start: string | null, end: string | null): string {
  if (!start) return '—';
  const fmt = (t: string) => {
    const [h, m] = t.split(':');
    return m && m !== '00' ? `${parseInt(h, 10)}h${m}` : `${parseInt(h, 10)}h`;
  };
  return end ? `${fmt(start)}–${fmt(end)}` : fmt(start);
}

function formatDateShort(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

function formatReceived(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) +
    ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export default function ProducerCommandesPage() {
  const [tab, setTab] = useState<Tab>('pending');
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const supabase = createSupabaseBrowserClient();

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (active) { setError('Vous devez être connecté.'); setLoading(false); }
        return;
      }

      const { data: prod } = await supabase
        .from('producers')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!prod) {
        if (active) { setError('Profil producteur introuvable.'); setLoading(false); }
        return;
      }

      const { data, error: fetchError } = await supabase
        .from('orders')
        .select(`
          id, code_commande, created_at, statut, montant_total,
          date_retrait, heure_retrait,
          consumer:consumer_id ( prenom, nom ),
          slots:slot_id ( heure_debut, heure_fin ),
          order_items ( quantite, products:product_id ( nom, unite ) )
        `)
        .eq('producer_id', prod.id)
        .order('created_at', { ascending: false });

      if (!active) return;

      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      const rows: OrderRow[] = ((data ?? []) as unknown as Array<{
        id: string;
        code_commande: string | null;
        created_at: string;
        statut: OrderStatus;
        montant_total: number | null;
        date_retrait: string | null;
        heure_retrait: string | null;
        consumer: { prenom: string | null; nom: string | null } | Array<{ prenom: string | null; nom: string | null }> | null;
        slots: { heure_debut: string | null; heure_fin: string | null } | Array<{ heure_debut: string | null; heure_fin: string | null }> | null;
        order_items: Array<{ quantite: number; products: { nom: string; unite: string } | Array<{ nom: string; unite: string }> | null }>;
      }>).map((o) => {
        const consumer = Array.isArray(o.consumer) ? o.consumer[0] : o.consumer;
        const slot = Array.isArray(o.slots) ? o.slots[0] : o.slots;
        const clientName = consumer?.prenom?.trim() || consumer?.nom?.trim() || 'Client';
        const items = (o.order_items ?? []).map((it) => {
          const p = Array.isArray(it.products) ? it.products[0] : it.products;
          const q = Number(it.quantite).toFixed(2).replace('.', ',');
          return {
            name: p?.nom ?? 'Produit',
            qty: `${q} ${p?.unite ?? ''}`.trim(),
          };
        });
        return {
          id: o.id,
          code_commande: o.code_commande,
          created_at: o.created_at,
          status: o.statut,
          client_name: clientName,
          total: Number(o.montant_total ?? 0),
          items,
          slotDate: formatDateShort(o.date_retrait),
          slotTime: formatRangeShort(slot?.heure_debut ?? o.heure_retrait, slot?.heure_fin ?? null),
        };
      });

      setOrders(rows);
      setLoading(false);
    })();

    return () => { active = false; };
  }, []);

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
          {loading ? (
            <div className="bg-white rounded-2xl border border-dark/[0.06] p-10 text-center text-dark/60">Chargement…</div>
          ) : filtered.length === 0 ? (
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
                    <Button size="sm" disabled={working === o.id} onClick={() => actOnOrder(o.id, 'confirm')}>
                      {working === o.id ? '…' : 'Confirmer la commande'}
                    </Button>
                  </>
                )}
                {(o.status === 'confirmed' || o.status === 'ready') && (
                  <Link href={`/commandes/${o.id}`}><Button size="sm">Voir le détail</Button></Link>
                )}
                {(o.status === 'completed' || o.status === 'cancelled' || o.status === 'refunded') && (
                  <Link href={`/commandes/${o.id}`}><Button variant="ghost" size="sm">Voir le détail</Button></Link>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
    </ProducerLayout>
  );
}
