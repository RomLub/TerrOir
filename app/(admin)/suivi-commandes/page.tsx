'use client';

import { useEffect, useMemo, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

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
  pending: { label: 'En attente', dot: 'bg-amber-400', bg: 'bg-amber-500/10', text: 'text-amber-300' },
  confirmed: { label: 'Confirmée', dot: 'bg-blue-400', bg: 'bg-blue-500/10', text: 'text-blue-300' },
  ready: { label: 'Prête', dot: 'bg-green-400', bg: 'bg-green-500/10', text: 'text-green-300' },
  completed: { label: 'Retirée', dot: 'bg-white/40', bg: 'bg-white/[0.06]', text: 'text-white/70' },
  cancelled: { label: 'Annulée', dot: 'bg-red-400', bg: 'bg-red-500/10', text: 'text-red-300' },
  refunded: { label: 'Remboursée', dot: 'bg-red-400', bg: 'bg-red-500/10', text: 'text-red-300' },
};

function startOfWeek(d: Date): Date {
  const c = new Date(d);
  const day = (c.getDay() + 6) % 7;
  c.setHours(0, 0, 0, 0);
  c.setDate(c.getDate() - day);
  return c;
}
function startOfDay(d: Date): Date { const c = new Date(d); c.setHours(0, 0, 0, 0); return c; }

function formatEuro(n: number): string { return `${n.toFixed(2).replace('.', ',')} €`; }

function formatDateShort(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

function formatTimeRange(start: string | null, end: string | null): string {
  if (!start) return '';
  const fmt = (t: string) => {
    const [h, m] = t.split(':');
    return m && m !== '00' ? `${parseInt(h, 10)}h${m}` : `${parseInt(h, 10)}h`;
  };
  return end ? `${fmt(start)}–${fmt(end)}` : fmt(start);
}

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
          slots:slot_id ( heure_debut, heure_fin )
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
        slots: { heure_debut: string | null; heure_fin: string | null } | Array<{ heure_debut: string | null; heure_fin: string | null }> | null;
      }>).map((o) => {
        const consumer = Array.isArray(o.consumer) ? o.consumer[0] : o.consumer;
        const producer = Array.isArray(o.producer) ? o.producer[0] : o.producer;
        const slot = Array.isArray(o.slots) ? o.slots[0] : o.slots;
        const slotTime = formatTimeRange(slot?.heure_debut ?? o.heure_retrait, slot?.heure_fin ?? null);
        return {
          id: o.id,
          code_commande: o.code_commande,
          client: [consumer?.prenom, consumer?.nom].filter(Boolean).join(' ').trim() || 'Client',
          producer: producer?.nom_exploitation ?? '—',
          created_at: o.created_at,
          date_retrait: o.date_retrait,
          slot_label: `${formatDateShort(o.date_retrait)}${slotTime ? ' ' + slotTime : ''}`,
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
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
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
      <header className="mb-8 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-green-400 font-semibold">Commandes</div>
            <h1 className="mt-1 font-serif text-[40px] text-white leading-tight">Toutes les commandes</h1>
            <p className="text-[14px] text-white/55 mt-1">
              {loading ? 'Chargement…' : `${orders.length} commandes récentes`}
            </p>
            {error && <p className="mt-2 text-[13px] text-red-300">{error}</p>}
          </div>
          <button onClick={exportCsv} disabled={filtered.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md bg-white/[0.06] border border-white/10 text-[14px] text-white hover:bg-white/10 disabled:opacity-60 disabled:cursor-not-allowed transition-colors">
            <span aria-hidden>⬇</span> Export CSV
          </button>
        </header>

        <section className="grid sm:grid-cols-3 gap-4 mb-8">
          <MetricCard label="Commandes aujourd'hui" value={String(metrics.today)} hint="Depuis 00h00" />
          <MetricCard label="CA semaine en cours" value={formatEuro(metrics.weekRevenue)} hint="Depuis lundi, hors annulées" />
          <MetricCard label="Taux de complétion" value={`${metrics.completion.toFixed(0)} %`} hint="Retirées / (retirées + annulées)" />
        </section>

        <section className="bg-black/30 border border-white/[0.06] rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between gap-4 p-4 border-b border-white/[0.06] flex-wrap">
            <div className="flex gap-1 flex-wrap">
              {FILTERS.map((f) => {
                const active = filter === f.value;
                return (
                  <button key={f.value} onClick={() => setFilter(f.value)}
                    className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
                      active ? 'bg-green-700 text-white' : 'bg-white/[0.03] text-white/65 hover:bg-white/[0.08] hover:text-white'
                    }`}>
                    {f.label}
                  </button>
                );
              })}
            </div>
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher ID, client, producteur…"
              className="w-full sm:w-80 rounded-md bg-black/40 border border-white/10 px-3 py-2 text-[13px] text-white placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500" />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-white/50 bg-white/[0.02] border-b border-white/[0.06]">
                  <th className="px-5 py-3 font-semibold">N°</th>
                  <th className="px-5 py-3 font-semibold">Client</th>
                  <th className="px-5 py-3 font-semibold">Producteur</th>
                  <th className="px-5 py-3 font-semibold">Créneau</th>
                  <th className="px-5 py-3 font-semibold">Statut</th>
                  <th className="px-5 py-3 font-semibold text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="px-5 py-10 text-center text-white/55">Chargement…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={6} className="px-5 py-10 text-center text-white/55">Aucune commande ne correspond.</td></tr>
                ) : filtered.map((o) => {
                  const meta = STATUS_META[o.status];
                  return (
                    <tr key={o.id} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
                      <td className="px-5 py-4 font-mono text-[12px] text-white/80">{o.code_commande ?? '—'}</td>
                      <td className="px-5 py-4 text-white">{o.client}</td>
                      <td className="px-5 py-4 text-green-300">{o.producer}</td>
                      <td className="px-5 py-4 text-white/70">{o.slot_label}</td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium ${meta.bg} ${meta.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right font-serif text-[17px] text-white tabular-nums">{formatEuro(o.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="px-5 py-3 border-t border-white/[0.06] flex items-center justify-between text-[12px] text-white/55">
            <span>{filtered.length} commande{filtered.length > 1 ? 's' : ''}</span>
            <span className="font-mono">
              Total filtré : <span className="text-white">{formatEuro(filtered.reduce((s, o) => s + o.total, 0))}</span>
            </span>
          </div>
      </section>
    </div>
  );
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="bg-black/30 border border-white/[0.06] rounded-2xl p-6">
      <div className="text-[11px] uppercase tracking-[0.18em] text-green-400 font-semibold">{label}</div>
      <div className="mt-2 font-serif text-[36px] text-white leading-none tabular-nums">{value}</div>
      <div className="mt-2 text-[12px] text-white/50">{hint}</div>
    </div>
  );
}
