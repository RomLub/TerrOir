'use client';

import { useMemo, useState } from 'react';
import { AdminLayout } from '../_components/AdminLayout';

type Status = 'pending' | 'confirmed' | 'ready' | 'completed' | 'cancelled';

type Order = {
  id: string;
  client: string;
  producer: string;
  date: string;
  slot: string;
  total: number;
  status: Status;
};

const ORDERS: Order[] = [
  { id: 'TRO-8K2M1P', client: 'Camille Rousseau', producer: 'Ferme des Chênes', date: '2026-04-20', slot: '25 avr. 10h–12h', total: 89.00, status: 'pending' },
  { id: 'TRO-3X7V5L', client: 'Thomas Vignier', producer: 'Domaine Saint-Martin', date: '2026-04-19', slot: '29 avr. 17h–19h', total: 106.15, status: 'pending' },
  { id: 'TRO-7A9K2X', client: 'Marie Dubois', producer: 'Ferme des Chênes', date: '2026-04-20', slot: '25 avr. 10h–12h', total: 101.55, status: 'confirmed' },
  { id: 'TRO-5B1N7Q', client: 'Antoine Martin', producer: 'Bergerie du Causse', date: '2026-04-18', slot: '22 avr. 17h–19h', total: 37.00, status: 'ready' },
  { id: 'TRO-4H2P8M', client: 'Sophie Laurent', producer: 'Le Potager de Lucie', date: '2026-04-20', slot: '24 avr. 15h–17h', total: 28.50, status: 'confirmed' },
  { id: 'TRO-2K9L5F', client: 'Hélène Tissot', producer: "La Ruche d'Or", date: '2026-04-17', slot: '20 avr. 10h–12h', total: 42.00, status: 'completed' },
  { id: 'TRO-9X3V1B', client: 'Julien Karim', producer: 'Ferme des Chênes', date: '2026-04-16', slot: '19 avr. 10h–12h', total: 89.00, status: 'completed' },
  { id: 'TRO-1N8T6Z', client: 'Anne Petit', producer: 'Domaine Saint-Martin', date: '2026-04-15', slot: '18 avr. 17h–19h', total: 64.20, status: 'completed' },
  { id: 'TRO-6Y4W2C', client: 'Paul Bernard', producer: 'Bergerie du Causse', date: '2026-04-14', slot: '17 avr. 10h–12h', total: 55.00, status: 'cancelled' },
  { id: 'TRO-8R5G1D', client: 'Lucie Moreau', producer: 'Le Potager de Lucie', date: '2026-04-20', slot: '23 avr. 15h–17h', total: 34.80, status: 'confirmed' },
];

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
};

const TODAY = '2026-04-20';
const WEEK_START = new Date('2026-04-13');

function formatEuro(n: number) {
  return n.toFixed(2).replace('.', ',') + ' €';
}

function csvEscape(v: string | number) {
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function AdminCommandesPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

  const metrics = useMemo(() => {
    const today = ORDERS.filter((o) => o.date === TODAY).length;
    const weekOrders = ORDERS.filter((o) => {
      const d = new Date(o.date);
      return d >= WEEK_START && o.status !== 'cancelled';
    });
    const weekRevenue = weekOrders.reduce((s, o) => s + o.total, 0);
    const finished = ORDERS.filter((o) => o.status === 'completed').length;
    const closed = ORDERS.filter((o) => o.status === 'completed' || o.status === 'cancelled').length;
    const completion = closed > 0 ? (finished / closed) * 100 : 0;
    return { today, weekRevenue, completion };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ORDERS.filter((o) => {
      if (filter !== 'all' && o.status !== filter) return false;
      if (!q) return true;
      return o.id.toLowerCase().includes(q) || o.client.toLowerCase().includes(q) || o.producer.toLowerCase().includes(q);
    });
  }, [filter, search]);

  const exportCsv = () => {
    const header = ['id', 'client', 'producteur', 'date', 'creneau', 'total_eur', 'statut'];
    const rows = filtered.map((o) => [o.id, o.client, o.producer, o.date, o.slot, o.total.toFixed(2), o.status]);
    const csv = [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `terroir-commandes-${TODAY}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AdminLayout>
      <div className="max-w-7xl mx-auto px-8 py-10">
        <header className="mb-8 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-green-400 font-semibold">Commandes</div>
            <h1 className="mt-1 font-serif text-[40px] text-white leading-tight">Toutes les commandes</h1>
            <p className="text-[14px] text-white/55 mt-1">Supervisez le flux quotidien et exportez pour la comptabilité.</p>
          </div>
          <button onClick={exportCsv}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md bg-white/[0.06] border border-white/10 text-[14px] text-white hover:bg-white/10 transition-colors">
            <span aria-hidden>⬇</span> Export CSV
          </button>
        </header>

        <section className="grid sm:grid-cols-3 gap-4 mb-8">
          <MetricCard label="Commandes aujourd'hui" value={metrics.today.toString()} hint={TODAY} />
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
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-white/55">Aucune commande ne correspond.</td>
                  </tr>
                ) : filtered.map((o) => {
                  const meta = STATUS_META[o.status];
                  return (
                    <tr key={o.id} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
                      <td className="px-5 py-4 font-mono text-[12px] text-white/80">{o.id}</td>
                      <td className="px-5 py-4 text-white">{o.client}</td>
                      <td className="px-5 py-4 text-green-300">{o.producer}</td>
                      <td className="px-5 py-4 text-white/70">{o.slot}</td>
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
    </AdminLayout>
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
