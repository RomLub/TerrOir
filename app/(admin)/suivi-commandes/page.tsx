'use client';

import { useEffect, useMemo, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  formatSlotRange,
  formatLegacyTimeHHMM,
} from '@/lib/slots/format-slot-time';
import { formatDateFr } from '@/lib/format/date';
import { formatEuro } from '@/lib/format/currency';
import { AdminPageHeader, StatusDotBadge } from '@/components/ui';

type Status = 'pending' | 'confirmed' | 'ready' | 'completed' | 'cancelled' | 'refunded';

type Order = {
  id: string;
  code_commande: string | null;
  client: string;
  producer: string;
  created_at: string;
  date_retrait: string | null;
  slot_label: string;
  total: number;
  status: Status;
};

type Filter = 'all' | Status;
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Toutes' },
  { value: 'pending', label: 'À confirmer' },
  { value: 'confirmed', label: 'Confirmées' },
  { value: 'ready', label: 'Prêtes' },
  { value: 'completed', label: 'Terminées' },
  { value: 'cancelled', label: 'Annulées' },
];

const STATUS_META: Record<Status, { label: string; dot: string; bg: string; text: string }> = {
  pending:   { label: 'En attente', dot: 'bg-amber-500',         bg: 'bg-amber-50',          text: 'text-amber-800' },
  confirmed: { label: 'Confirmée',  dot: 'bg-amber-600',         bg: 'bg-amber-100',         text: 'text-amber-900' },
  ready:     { label: 'Prête',      dot: 'bg-terroir-green-700', bg: 'bg-terroir-green-100', text: 'text-terroir-green-700' },
  completed: { label: 'Retirée',    dot: 'bg-terroir-green-700', bg: 'bg-terroir-green-100', text: 'text-terroir-green-700' },
  cancelled: { label: 'Annulée',    dot: 'bg-red-500',           bg: 'bg-red-100',           text: 'text-red-700' },
  refunded:  { label: 'Remboursée', dot: 'bg-red-500',           bg: 'bg-red-100',           text: 'text-red-700' },
};

function startOfWeek(d: Date): Date {
  const c = new Date(d);
  const day = (c.getDay() + 6) % 7;
  c.setHours(0, 0, 0, 0);
  c.setDate(c.getDate() - day);
  return c;
}
function startOfDay(d: Date): Date { const c = new Date(d); c.setHours(0, 0, 0, 0); return c; }

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function AdminCommandesPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const supabase = createSupabaseBrowserClient();

    (async () => {
      const { data, error: fetchError } = await supabase
        .from('orders')
        .select(`
          id, code_commande, created_at, statut, montant_total, date_retrait, heure_retrait,
          consumer:consumer_id ( prenom, nom ),
          producer:producer_id ( nom_exploitation ),
          slots:slot_id ( starts_at, ends_at )
        `)
        .order('created_at', { ascending: false })
        .limit(200);

      if (!active) return;
      if (fetchError) { setError(fetchError.message); setLoading(false); return; }

      const rows: Order[] = ((data ?? []) as unknown as Array<{
        id: string;
        code_commande: string | null;
        created_at: string;
        statut: Status;
        montant_total: number | null;
        date_retrait: string | null;
        heure_retrait: string | null;
        consumer: { prenom: string | null; nom: string | null } | Array<{ prenom: string | null; nom: string | null }> | null;
        producer: { nom_exploitation: string } | Array<{ nom_exploitation: string }> | null;
        slots: { starts_at: string | null; ends_at: string | null } | Array<{ starts_at: string | null; ends_at: string | null }> | null;
      }>).map((o) => {
        const consumer = Array.isArray(o.consumer) ? o.consumer[0] : o.consumer;
        const producer = Array.isArray(o.producer) ? o.producer[0] : o.producer;
        const slot = Array.isArray(o.slots) ? o.slots[0] : o.slots;
        const slotTime = slot?.starts_at && slot?.ends_at
          ? formatSlotRange(slot.starts_at, slot.ends_at)
          : formatLegacyTimeHHMM(o.heure_retrait);
        return {
          id: o.id,
          code_commande: o.code_commande,
          client: [consumer?.prenom, consumer?.nom].filter(Boolean).join(' ').trim() || 'Client',
          producer: producer?.nom_exploitation ?? '—',
          created_at: o.created_at,
          date_retrait: o.date_retrait,
          slot_label: `${formatDateFr(o.date_retrait, { year: false })}${slotTime ? ' ' + slotTime : ''}`,
          total: Number(o.montant_total ?? 0),
          status: o.statut,
        };
      });

      setOrders(rows);
      setLoading(false);
    })();

    return () => { active = false; };
  }, []);

  const metrics = useMemo(() => {
    const now = new Date();
    const todayStart = startOfDay(now).getTime();
    const weekStart = startOfWeek(now).getTime();

    const today = orders.filter((o) => new Date(o.created_at).getTime() >= todayStart).length;
    const weekOrders = orders.filter((o) => new Date(o.created_at).getTime() >= weekStart && o.status !== 'cancelled' && o.status !== 'refunded');
    const weekRevenue = weekOrders.reduce((s, o) => s + o.total, 0);
    const finished = orders.filter((o) => o.status === 'completed').length;
    const closed = orders.filter((o) => o.status === 'completed' || o.status === 'cancelled' || o.status === 'refunded').length;
    const completion = closed > 0 ? (finished / closed) * 100 : 0;
    return { today, weekRevenue, completion };
  }, [orders]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (filter !== 'all' && o.status !== filter) return false;
      if (!q) return true;
      return (o.code_commande ?? '').toLowerCase().includes(q)
        || o.client.toLowerCase().includes(q)
        || o.producer.toLowerCase().includes(q);
    });
  }, [orders, filter, search]);

  const exportCsv = () => {
    const header = ['id', 'code_commande', 'client', 'producteur', 'date_creation', 'date_retrait', 'creneau', 'total_eur', 'statut'];
    const rows = filtered.map((o) => [
      o.id, o.code_commande ?? '', o.client, o.producer,
      o.created_at.slice(0, 19).replace('T', ' '),
      o.date_retrait ?? '',
      o.slot_label,
      o.total.toFixed(2),
      o.status,
    ]);
    const csv = [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const today = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = url;
    a.download = `terroir-commandes-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <AdminPageHeader
        eyebrow="Commandes"
        title="Toutes les commandes"
        subtitle={loading ? 'Chargement…' : `${orders.length} commandes récentes`}
        error={error}
        right={
          <button onClick={exportCsv} disabled={filtered.length === 0}
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2.5 text-[14px] text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60">
            <span aria-hidden>⬇</span> Export CSV
          </button>
        }
      />

      <section className="mb-8 grid gap-4 sm:grid-cols-3">
        <MetricCard label="Commandes aujourd'hui" value={String(metrics.today)} hint="Depuis 00h00" />
        <MetricCard label="CA semaine en cours" value={formatEuro(metrics.weekRevenue)} hint="Depuis lundi, hors annulées" />
        <MetricCard label="Taux de complétion" value={`${metrics.completion.toFixed(0)} %`} hint="Retirées / (retirées + annulées)" />
      </section>

      <section className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 p-4">
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => {
              const active = filter === f.value;
              return (
                <button key={f.value} onClick={() => setFilter(f.value)}
                  className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
                    active ? 'bg-terroir-green-700 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}>
                  {f.label}
                </button>
              );
            })}
          </div>
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher ID, client, producteur…"
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-[13px] text-gray-900 placeholder:text-gray-400 focus:border-terroir-green-700 focus:outline-none focus:ring-2 focus:ring-terroir-green-700 sm:w-80" />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-100 text-left text-[11px] uppercase tracking-[0.14em] text-gray-600">
                <th className="px-5 py-3 font-semibold">N°</th>
                <th className="px-5 py-3 font-semibold">Client</th>
                <th className="px-5 py-3 font-semibold">Producteur</th>
                <th className="px-5 py-3 font-semibold">Créneau</th>
                <th className="px-5 py-3 font-semibold">Statut</th>
                <th className="px-5 py-3 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-gray-500">Chargement…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-gray-500">Aucune commande ne correspond.</td></tr>
              ) : filtered.map((o) => (
                  <tr key={o.id} className="border-b border-gray-200 last:border-0 hover:bg-gray-50">
                    <td className="px-5 py-4 font-mono text-[12px] text-gray-700">{o.code_commande ?? '—'}</td>
                    <td className="px-5 py-4 text-gray-900">{o.client}</td>
                    <td className="px-5 py-4 text-terroir-green-700">{o.producer}</td>
                    <td className="px-5 py-4 text-gray-700">{o.slot_label}</td>
                    <td className="px-5 py-4">
                      <StatusDotBadge {...STATUS_META[o.status]} />
                    </td>
                    <td className="px-5 py-4 text-right font-serif text-[17px] tabular-nums text-gray-900">{formatEuro(o.total)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-gray-200 px-5 py-3 text-[12px] text-gray-500">
          <span>{filtered.length} commande{filtered.length > 1 ? 's' : ''}</span>
          <span className="font-mono">
            Total filtré : <span className="text-gray-900">{formatEuro(filtered.reduce((s, o) => s + o.total, 0))}</span>
          </span>
        </div>
      </section>
    </div>
  );
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-6 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-terroir-green-700">{label}</div>
      <div className="mt-2 font-serif text-[36px] leading-none tabular-nums text-gray-900">{value}</div>
      <div className="mt-2 text-[12px] text-gray-500">{hint}</div>
    </div>
  );
}
