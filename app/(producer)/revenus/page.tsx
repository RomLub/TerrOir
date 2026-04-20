'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui';
import { ProducerLayout } from '../_components/ProducerLayout';

const NEXT_PAYOUT = { amount: 847.32, date: 'Lundi 27 avril 2026', orders: 9 };

const WEEKS = [
  { label: 'S13', value: 620 }, { label: 'S14', value: 890 }, { label: 'S15', value: 540 },
  { label: 'S16', value: 1120 }, { label: 'S17', value: 780 }, { label: 'S18', value: 1340 },
  { label: 'S19', value: 1020 }, { label: 'S20', value: 1248 },
];

const PAYOUTS = [
  { period: '14 – 20 avril', orders: 8, gross: 1020.00, commission: 61.20, net: 958.80 },
  { period: '7 – 13 avril', orders: 11, gross: 1340.50, commission: 80.43, net: 1260.07 },
  { period: '31 mars – 6 avril', orders: 7, gross: 780.00, commission: 46.80, net: 733.20 },
  { period: '24 – 30 mars', orders: 9, gross: 1120.00, commission: 67.20, net: 1052.80 },
  { period: '17 – 23 mars', orders: 5, gross: 540.00, commission: 32.40, net: 507.60 },
];

export default function RevenusPage() {
  const max = Math.max(...WEEKS.map((w) => w.value));

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
                {NEXT_PAYOUT.amount.toFixed(2).replace('.', ',')}
                <span className="text-[40px] text-terra-300"> €</span>
              </div>
            </div>
            <p className="mt-4 text-[16px] text-green-100/85">
              Sera viré le <span className="font-semibold text-white">{NEXT_PAYOUT.date}</span> · {NEXT_PAYOUT.orders} commandes finalisées
            </p>
          </div>
        </section>

        <section className="mb-10 bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6 md:p-8">
          <div className="flex items-end justify-between mb-6">
            <h2 className="font-serif text-[24px] text-green-900">Évolution sur 8 semaines</h2>
            <span className="text-[12px] mono text-dark/50">en €</span>
          </div>
          <div className="h-56 flex items-end justify-between gap-3">
            {WEEKS.map((w, i) => {
              const h = (w.value / max) * 100;
              const isLast = i === WEEKS.length - 1;
              return (
                <div key={w.label} className="flex-1 flex flex-col items-center gap-2 group">
                  <div className="text-[11px] mono text-dark/50 tabular-nums">{w.value}</div>
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
                  <th className="text-right px-4 py-3 font-semibold">Commandes</th>
                  <th className="text-right px-4 py-3 font-semibold">Brut</th>
                  <th className="text-right px-4 py-3 font-semibold">Commission 6%</th>
                  <th className="text-right px-4 py-3 font-semibold">Net viré</th>
                  <th className="text-left px-4 py-3 font-semibold">Statut</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark/[0.06]">
                {PAYOUTS.map((p, i) => (
                  <tr key={i} className="hover:bg-green-100/20 transition-colors">
                    <td className="px-6 py-4 text-dark font-medium">{p.period}</td>
                    <td className="px-4 py-4 text-right tabular-nums text-dark/70">{p.orders}</td>
                    <td className="px-4 py-4 text-right tabular-nums text-dark/70">{p.gross.toFixed(2).replace('.', ',')} €</td>
                    <td className="px-4 py-4 text-right tabular-nums text-terra-700">−{p.commission.toFixed(2).replace('.', ',')} €</td>
                    <td className="px-4 py-4 text-right tabular-nums font-serif text-[16px] text-green-900">{p.net.toFixed(2).replace('.', ',')} €</td>
                    <td className="px-4 py-4"><Badge>Viré</Badge></td>
                    <td className="px-4 py-4"><Link href={`/revenus/${i}`} className="text-[12px] text-green-700 hover:text-green-900 font-medium">Détail →</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </ProducerLayout>
  );
}
