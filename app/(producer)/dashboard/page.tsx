'use client';

import Link from 'next/link';
import { Button, ProducerBadge } from '@/components/ui';
import { ProducerLayout } from '../_components/ProducerLayout';

const ALERTS = [
  { kind: 'urgent' as const, text: '2 commandes en attente de confirmation depuis plus de 12 h', href: '/commandes?tab=pending' },
  { kind: 'warning' as const, text: 'Stock faible : Entrecôte maturée (5 kg restants)', href: '/catalogue' },
];

const METRICS = [
  { label: "Commandes aujourd'hui", value: '4', sub: '+1 depuis hier', tone: 'green' as const },
  { label: 'Revenus cette semaine', value: '1 248 €', sub: '+18% vs semaine passée', tone: 'green' as const },
  { label: 'Note moyenne', value: '4,8', sub: '127 avis', tone: 'terra' as const },
  { label: 'Prochain retrait', value: '14h00', sub: 'Marie · TRO-7A9K2X', tone: 'terra' as const },
];

const PENDING = [
  { id: 'TRO-8K2M1P', client: 'Camille', items: '1 colis découverte 5 kg', total: 89.00, slot: 'Samedi 25 avril · 10h–12h', hoursLeft: 4 },
  { id: 'TRO-3X7V5L', client: 'Thomas', items: '2,5 kg entrecôte · 1 kg bourguignon', total: 106.15, slot: 'Mercredi 29 avril · 17h–19h', hoursLeft: 9 },
];

const WEEK_DAYS = ['Lun 21', 'Mar 22', 'Mer 23', 'Jeu 24', 'Ven 25', 'Sam 26', 'Dim 27'];
const WEEK_SLOTS: Record<string, { time: string; orders: number }[]> = {
  'Mer 23': [{ time: '17–19h', orders: 2 }],
  'Ven 25': [{ time: '10–12h', orders: 3 }, { time: '14–17h', orders: 1 }],
  'Sam 26': [{ time: '10–12h', orders: 4 }],
};

const BADGES = [
  { kind: 'stock' as const, score: 98, tip: 'Excellent. Continuez à actualiser vos stocks après chaque vente.' },
  { kind: 'response' as const, score: 72, tip: 'Confirmez vos commandes plus rapidement pour atteindre 85+.' },
  { kind: 'reliability' as const, score: 100, tip: 'Parfait. Aucun désistement sur vos 30 dernières commandes.' },
];

export default function ProducerDashboardPage() {
  return (
    <ProducerLayout>
      <div className="max-w-6xl mx-auto px-8 py-10">
        <header className="mb-8">
          <div className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold">Tableau de bord</div>
          <h1 className="mt-1 font-serif text-[40px] text-green-900 leading-tight">Bonjour Pierre 👋</h1>
          <p className="text-[14px] text-dark/60 mt-1">Voici ce qu&apos;il se passe à la Ferme des Chênes aujourd&apos;hui.</p>
        </header>

        {ALERTS.length > 0 && (
          <div className="mb-8 space-y-2">
            {ALERTS.map((a, i) => (
              <Link key={i} href={a.href}
                className={`flex items-center justify-between gap-4 p-4 rounded-xl border transition-colors ${
                  a.kind === 'urgent'
                    ? 'bg-terra-100/60 border-terra-300/60 hover:bg-terra-100'
                    : 'bg-amber-50 border-amber-200 hover:bg-amber-100/60'
                }`}>
                <div className="flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full ${a.kind === 'urgent' ? 'bg-terra-700 animate-pulse' : 'bg-amber-500'}`} />
                  <span className="text-[14px] text-dark font-medium">{a.text}</span>
                </div>
                <span className="text-[13px] text-dark/60">Voir →</span>
              </Link>
            ))}
          </div>
        )}

        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
          {METRICS.map((m) => (
            <div key={m.label} className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-5">
              <div className="text-[11px] uppercase tracking-[0.12em] text-dark/55 font-semibold">{m.label}</div>
              <div className={`mt-2 font-serif text-[36px] leading-none tabular-nums ${m.tone === 'terra' ? 'text-terra-700' : 'text-green-900'}`}>{m.value}</div>
              <div className="mt-1.5 text-[12px] text-dark/55 mono">{m.sub}</div>
            </div>
          ))}
        </section>

        <section className="mb-10">
          <div className="flex items-end justify-between mb-4">
            <div>
              <h2 className="font-serif text-[28px] text-green-900 leading-tight">À confirmer</h2>
              <p className="text-[13px] text-dark/60 mt-0.5">Confirmez dans les 24 h pour ne pas pénaliser votre score de réactivité.</p>
            </div>
            <Link href="/commandes" className="text-[13px] text-green-700 font-medium hover:text-green-900">Toutes les commandes →</Link>
          </div>
          <div className="space-y-3">
            {PENDING.map((p) => (
              <article key={p.id} className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-5">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-[12px] mono text-dark/50">
                      <span>{p.id}</span><span>·</span><span>{p.slot}</span>
                    </div>
                    <div className="mt-1 font-serif text-[20px] text-green-900">{p.client}</div>
                    <div className="text-[13px] text-dark/70 mt-0.5">{p.items}</div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="font-serif text-[20px] text-green-900 tabular-nums">{p.total.toFixed(2).replace('.', ',')} €</div>
                      <div className={`text-[11px] mono mt-0.5 ${p.hoursLeft < 6 ? 'text-terra-700 font-semibold' : 'text-dark/50'}`}>
                        ⏱ {p.hoursLeft}h restantes
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm">Annuler</Button>
                      <Button size="sm">Confirmer</Button>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="mb-10">
          <h2 className="font-serif text-[28px] text-green-900 leading-tight mb-4">Planning de la semaine</h2>
          <div className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-5">
            <div className="grid grid-cols-7 gap-2">
              {WEEK_DAYS.map((d) => {
                const slots = WEEK_SLOTS[d] || [];
                const isToday = d === 'Ven 25';
                return (
                  <div key={d} className={`rounded-xl p-3 min-h-[120px] border ${isToday ? 'bg-green-100/60 border-green-500' : 'bg-bg border-dark/[0.06]'}`}>
                    <div className={`text-[12px] font-semibold uppercase tracking-wider mb-2 ${isToday ? 'text-green-900' : 'text-dark/60'}`}>{d}</div>
                    <div className="space-y-1.5">
                      {slots.length === 0 ? (
                        <div className="text-[11px] text-dark/30 italic">—</div>
                      ) : slots.map((s, i) => (
                        <div key={i} className="rounded-md bg-terra-700/10 border border-terra-700/20 p-1.5">
                          <div className="text-[11px] mono text-terra-700 font-semibold">{s.time}</div>
                          <div className="text-[11px] text-dark/70 mt-0.5">{s.orders} cmd.</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section>
          <h2 className="font-serif text-[28px] text-green-900 leading-tight mb-1">Badges de fiabilité</h2>
          <p className="text-[13px] text-dark/60 mb-5">Ces badges sont affichés publiquement sur votre page.</p>
          <div className="grid md:grid-cols-3 gap-4">
            {BADGES.map((b) => (
              <div key={b.kind} className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-5">
                <ProducerBadge kind={b.kind} score={b.score} />
                <div className={`mt-4 font-serif text-[44px] leading-none tabular-nums ${
                  b.score >= 90 ? 'text-green-700' : 'text-terra-700'
                }`}>{b.score}<span className="text-[20px] text-dark/40"> / 100</span></div>
                <p className="mt-3 text-[13px] text-dark/70 leading-relaxed">{b.tip}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </ProducerLayout>
  );
}
