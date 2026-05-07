import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui';
import { getSessionUser } from '@/lib/auth/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { fetchProducerForUser } from '@/lib/producers/context';
import { ProducerLayout } from '../_components/ProducerLayout';
import { mapStatusToBadge } from './_lib/badge-mapping';

function startOfWeek(d: Date): Date {
  const copy = new Date(d);
  const day = (copy.getDay() + 6) % 7;
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() - day);
  return copy;
}

function addDays(d: Date, n: number): Date { const c = new Date(d); c.setDate(c.getDate() + n); return c; }

function weekLabel(d: Date): string {
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const jan4Week = startOfWeek(jan4);
  const diffDays = Math.round((startOfWeek(d).getTime() - jan4Week.getTime()) / 86_400_000);
  const week = 1 + Math.floor(diffDays / 7);
  return `S${week.toString().padStart(2, '0')}`;
}

function formatPeriod(startIso: string, endIso: string): string {
  const start = new Date(startIso + 'T00:00:00');
  const end = new Date(endIso + 'T00:00:00');
  const sameMonth = start.getMonth() === end.getMonth();
  const fmtDay = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: sameMonth ? undefined : 'long' });
  const fmtMonth = (d: Date) => d.toLocaleDateString('fr-FR', { month: 'long' });
  if (sameMonth) {
    return `${start.getDate()} – ${end.getDate()} ${fmtMonth(start)}`;
  }
  return `${fmtDay(start)} – ${end.getDate()} ${fmtMonth(end)}`;
}

function formatEuro(n: number): string {
  return `${n.toFixed(2).replace('.', ',')} €`;
}

export default async function RevenusPage() {
  const session = await getSessionUser();
  if (!session) redirect('/connexion');

  const supabase = await createSupabaseServerClient();
  const producer = await fetchProducerForUser(supabase, session.id);
  if (!producer) redirect('/invitation');

  const admin = createSupabaseAdminClient();

  const { data: payouts } = await admin
    .from('payouts')
    .select('id, periode_debut, periode_fin, montant_brut, commission, montant_net, statut, created_at')
    .eq('producer_id', producer.id)
    .order('periode_debut', { ascending: false });

  // T-414 — Bundle 2 PR 2b. La nouvelle séquence cron weekly-payout (cf
  // lib/stripe/payouts.ts) ne crée plus de rows 'pending' : INSERT direct
  // 'processing'. Les rows 'pending' affichés en hero ne devraient subsister
  // que pour les anciens cycles legacy. L'historique inclut désormais
  // 'processing' (en cours), 'paid' (réglé), 'failed' (échec — Bundle 3 TB).
  const nextPending = (payouts ?? []).find((p) => p.statut === 'pending');
  const historicalPayouts = (payouts ?? []).filter((p) => p.statut !== 'pending');

  // Aggregate last 8 ISO weeks from orders (completed not cancelled).
  const now = new Date();
  const weekStarts: Date[] = [];
  for (let i = 7; i >= 0; i--) {
    weekStarts.push(addDays(startOfWeek(now), -i * 7));
  }
  const eightWeeksAgo = weekStarts[0];

  const { data: orders } = await admin
    .from('orders')
    .select('montant_net_producteur, statut, completed_at, created_at')
    .eq('producer_id', producer.id)
    .gte('created_at', eightWeeksAgo.toISOString());

  const revenueByWeek = weekStarts.map((ws) => {
    const we = addDays(ws, 7);
    const value = (orders ?? [])
      .filter((o) => {
        if (o.statut === 'cancelled' || o.statut === 'refunded') return false;
        const ref = o.completed_at ?? o.created_at;
        if (!ref) return false;
        const t = new Date(ref).getTime();
        return t >= ws.getTime() && t < we.getTime();
      })
      .reduce((s, o) => s + Number(o.montant_net_producteur ?? 0), 0);
    return { label: weekLabel(ws), value: Math.round(value * 100) / 100 };
  });

  const max = Math.max(1, ...revenueByWeek.map((w) => w.value));

  // Orders count for next pending payout
  let nextOrderCount = 0;
  if (nextPending?.periode_debut && nextPending?.periode_fin) {
    const { count } = await admin
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('producer_id', producer.id)
      .eq('statut', 'completed')
      .gte('completed_at', nextPending.periode_debut + 'T00:00:00')
      .lt('completed_at', nextPending.periode_fin + 'T23:59:59');
    nextOrderCount = count ?? 0;
  }

  const nextDateLabel = nextPending?.periode_fin
    ? addDays(new Date(nextPending.periode_fin + 'T00:00:00'), 2).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : 'Prochain lundi';

  return (
    <ProducerLayout>
      <div className="max-w-6xl mx-auto px-8 py-10">
        <header className="mb-8">
          <div className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold">Revenus</div>
          <h1 className="mt-1 font-serif text-[40px] text-green-900 leading-tight">Vos revenus</h1>
        </header>

        <section className="mb-10 bg-green-900 text-white rounded-3xl p-8 md:p-10 relative overflow-hidden">
          <div className="absolute -right-20 -top-20 w-64 h-64 rounded-full bg-terra-700/30 blur-3xl" />
          <div className="relative">
            <div className="text-[11px] uppercase tracking-[0.2em] text-terra-300 font-semibold">Prochain virement</div>
            <div className="mt-3 flex items-baseline gap-3 flex-wrap">
              <div className="font-serif text-[72px] md:text-[88px] leading-none tabular-nums">
                {nextPending ? Number(nextPending.montant_net).toFixed(2).replace('.', ',') : '0,00'}
                <span className="text-[40px] text-terra-300"> €</span>
              </div>
            </div>
            <p className="mt-4 text-[16px] text-green-100/85">
              {nextPending
                ? <>Sera viré le <span className="font-semibold text-white">{nextDateLabel}</span> · {nextOrderCount} commande{nextOrderCount > 1 ? 's' : ''} finalisée{nextOrderCount > 1 ? 's' : ''}</>
                : <>Aucun virement en attente — continuez à livrer vos clients !</>}
            </p>
          </div>
        </section>

        <section className="mb-10 bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6 md:p-8">
          <div className="flex items-end justify-between mb-6">
            <h2 className="font-serif text-[24px] text-green-900">Évolution sur 8 semaines</h2>
            <span className="text-[12px] mono text-dark/50">en €</span>
          </div>
          <div className="h-56 flex items-end justify-between gap-3">
            {revenueByWeek.map((w, i) => {
              const h = max > 0 ? (w.value / max) * 100 : 0;
              const isLast = i === revenueByWeek.length - 1;
              return (
                <div key={`${w.label}-${i}`} className="flex-1 flex flex-col items-center gap-2 group">
                  <div className="text-[11px] mono text-dark/50 tabular-nums">{Math.round(w.value)}</div>
                  <div className="w-full flex-1 flex items-end">
                    <div className={`w-full rounded-t-md transition-all ${isLast ? 'bg-terra-700' : 'bg-green-700'} group-hover:opacity-80`}
                      style={{ height: `${h}%` }} />
                  </div>
                  <div className={`text-[11px] mono font-semibold ${isLast ? 'text-terra-700' : 'text-dark/60'}`}>{w.label}</div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft overflow-hidden">
          <div className="p-6 border-b border-dark/[0.06]">
            <h2 className="font-serif text-[24px] text-green-900">Historique des virements</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-bg text-[11px] uppercase tracking-[0.1em] text-dark/55">
                <tr>
                  <th className="text-left px-6 py-3 font-semibold">Période</th>
                  <th className="text-right px-4 py-3 font-semibold">Brut</th>
                  <th className="text-right px-4 py-3 font-semibold">Commission 6%</th>
                  <th className="text-right px-4 py-3 font-semibold">Net viré</th>
                  <th className="text-left px-4 py-3 font-semibold">Statut</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark/[0.06]">
                {historicalPayouts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-dark/55">Aucun virement pour le moment.</td>
                  </tr>
                ) : historicalPayouts.map((p) => {
                  const badge = mapStatusToBadge(p.statut);
                  return (
                  <tr key={p.id} className="hover:bg-green-100/20 transition-colors">
                    <td className="px-6 py-4 text-dark font-medium">{formatPeriod(p.periode_debut, p.periode_fin)}</td>
                    <td className="px-4 py-4 text-right tabular-nums text-dark/70">{formatEuro(Number(p.montant_brut ?? 0))}</td>
                    <td className="px-4 py-4 text-right tabular-nums text-terra-700">−{formatEuro(Number(p.commission ?? 0))}</td>
                    <td className="px-4 py-4 text-right tabular-nums font-serif text-[16px] text-green-900">{formatEuro(Number(p.montant_net ?? 0))}</td>
                    <td className="px-4 py-4"><Badge variant={badge.variant}>{badge.label}</Badge></td>
                    <td className="px-4 py-4"><Link href={`/revenus/${p.id}`} className="text-[12px] text-green-700 hover:text-green-900 font-medium">Détail →</Link></td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </ProducerLayout>
  );
}
