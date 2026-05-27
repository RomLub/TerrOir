'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { Button, ProducerBadge } from '@/components/ui';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  PUBLICATION_CRITERIA,
  type CriterionKey,
} from '@/lib/producers/publication-criteria';
import { WeekNavigator } from '../_components/WeekNavigator';

// Nombre max d'étapes restantes affichées inline dans la carte « mise en
// ligne » : au-delà on tronque à 3 + « et X autre(s)… » pour rester sur une
// ligne lisible mobile.
const PUBLICATION_INLINE_MAX = 4;

type PendingOrder = {
  id: string;
  codeCommande: string | null;
  clientFirstName: string;
  itemsSummary: string;
  total: number;
  slotLabel: string;
  hoursLeft: number;
};

export type DashboardData = {
  producerId: string;
  producerName: string;
  firstName: string;
  /** Offset de semaine consulté (0 = semaine en cours, négatif = passé). */
  weekOffset: number;
  /** Libellé de la semaine consultée (ex. « 19 – 25 mai »). */
  weekPeriodLabel: string;
  ordersToday: number;
  ordersYesterday: number;
  revenueWeek: number;
  revenueLastWeek: number;
  rating: number;
  reviewCount: number;
  nextPickup: { label: string; sub: string } | null;
  pendingOrders: PendingOrder[];
  weekPlanning: { day: string; isToday: boolean; slots: { time: string; orders: number }[] }[];
  badges: { kind: 'stock' | 'response' | 'reliability'; score: number; tip: string }[];
  stockAlerts: { id: string; nom: string; stock: number }[];
  /**
   * État du bloc « mise en ligne » (item « à traiter »).
   * - `todo` : il reste des critères à compléter (0-5/6) OU tout est prêt
   *   (6/6) mais la demande n'a pas encore été envoyée.
   * - `wait` : la demande a été envoyée, on attend la validation admin.
   * - `null` : fiche déjà publique (pas de carte) ou cas pathologique.
   */
  publicationToDo:
    | { kind: 'todo'; doneCount: number; missingKeys: CriterionKey[] }
    | { kind: 'wait' }
    | null;
};

function euros(n: number): string {
  return `${n.toFixed(2).replace('.', ',')} €`;
}

// Carte « mise en ligne » — état todo. Deux layouts distincts :
//
//   - 6/6 (rien dans missingKeys) : tout est prêt, on incite à demander la
//     publication. Card globalement cliquable (<Link>) vers le panneau de
//     publication (/ma-page?tab=edit&focus=publication). "Voir →" conservé.
//
//   - 0-5/6 : on liste les étapes restantes par leur shortLabel, tronqué à
//     PUBLICATION_INLINE_MAX. Chaque étape est un <Link> propre vers sa page
//     de complétion (cf. PUBLICATION_CRITERIA[i].href). Plus de wrapper Link
//     global (HTML invalide <a><a></a></a>), plus de "Voir →" (redondant).
//
// Exporté pour permettre des tests de rendu isolés sans avoir à instancier
// DashboardClient et toute sa machinerie realtime Supabase.
export function PublicationTodoCard({
  doneCount,
  missingKeys,
}: {
  doneCount: number;
  missingKeys: CriterionKey[];
}) {
  const total = PUBLICATION_CRITERIA.length;
  const allDone = missingKeys.length === 0;

  if (allDone) {
    return (
      <Link
        href="/ma-page?tab=edit&focus=publication"
        className="flex items-start justify-between gap-4 p-4 rounded-xl border bg-green-100/60 border-green-300/60 hover:bg-green-100 transition-colors"
      >
        <div className="flex items-start gap-3 min-w-0">
          <span className="mt-1.5 w-2 h-2 rounded-full bg-green-700 shrink-0" />
          <div className="text-[14px] text-dark font-medium">
            Tout est prêt — demandez la publication
          </div>
        </div>
        <span className="text-[13px] text-dark/60 shrink-0 mt-0.5">Voir →</span>
      </Link>
    );
  }

  const missingMetas = missingKeys
    .map((key) => PUBLICATION_CRITERIA.find((c) => c.key === key))
    .filter((m): m is (typeof PUBLICATION_CRITERIA)[number] => Boolean(m));
  const inlineMetas = missingMetas.slice(0, PUBLICATION_INLINE_MAX);
  const overflow = missingMetas.length - inlineMetas.length;

  return (
    <div className="flex items-start gap-3 p-4 rounded-xl border bg-green-100/60 border-green-300/60">
      <span className="mt-1.5 w-2 h-2 rounded-full bg-green-700 shrink-0" />
      <div className="min-w-0">
        <div className="text-[14px] text-dark font-medium">
          Finalisez votre mise en ligne ({doneCount}/{total} étapes)
        </div>
        <div className="mt-1 text-[12px] text-dark/70">
          Il reste :{' '}
          {inlineMetas.map((m, i) => (
            <span key={m.key}>
              <Link
                href={m.href}
                className="underline decoration-dark/30 underline-offset-2 hover:text-terra-700 hover:decoration-terra-700 transition-colors"
              >
                {m.shortLabel}
              </Link>
              {i < inlineMetas.length - 1 ? ' · ' : ''}
            </span>
          ))}
          {overflow > 0
            ? ` et ${overflow} autre${overflow > 1 ? 's' : ''}…`
            : ''}
        </div>
      </div>
    </div>
  );
}

// Carte « mise en ligne » — état wait. La demande a été envoyée, on attend la
// validation admin. Non-cliquable (pas de CTA), pastille terra (état passif,
// distinct du vert d'action), pas d'engagement temporel.
// Exporté pour les tests de rendu isolés (cf. PublicationTodoCard).
export function PublicationWaitCard() {
  return (
    <div className="flex items-start gap-3 p-4 rounded-xl border bg-terra-100/60 border-terra-200">
      <span className="mt-1.5 w-2 h-2 rounded-full bg-terra-700 shrink-0" />
      <div className="min-w-0">
        <div className="text-[14px] text-dark font-medium">
          Demande de publication envoyée
        </div>
        <div className="mt-1 text-[12px] text-dark/60">
          L&apos;équipe TerrOir valide votre fiche, vous serez prévenu par
          email.
        </div>
      </div>
    </div>
  );
}

export function DashboardClient({ data: initial }: { data: DashboardData }) {
  const [data, setData] = useState(initial);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let channel: RealtimeChannel | null = null;

    channel = supabase
      .channel(`producer-dashboard-${initial.producerId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'orders',
          filter: `producer_id=eq.${initial.producerId}`,
        },
        () => {
          setData((d) => ({ ...d, ordersToday: d.ordersToday + 1 }));
        },
      )
      .subscribe();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [initial.producerId]);

  const revenueDelta = data.revenueLastWeek > 0
    ? Math.round(((data.revenueWeek - data.revenueLastWeek) / data.revenueLastWeek) * 100)
    : null;

  const isCurrentWeek = data.weekOffset === 0;

  const metrics = [
    {
      label: "Commandes aujourd'hui",
      value: String(data.ordersToday),
      sub: `${data.ordersToday >= data.ordersYesterday ? '+' : ''}${data.ordersToday - data.ordersYesterday} depuis hier`,
      tone: 'green' as const,
    },
    {
      label: isCurrentWeek ? 'Revenus cette semaine' : 'Revenus de la semaine',
      value: euros(data.revenueWeek),
      sub: revenueDelta === null ? '—' : `${revenueDelta >= 0 ? '+' : ''}${revenueDelta}% vs semaine passée`,
      tone: 'green' as const,
    },
    {
      label: 'Note moyenne',
      value: data.reviewCount ? data.rating.toFixed(1).replace('.', ',') : '—',
      sub: `${data.reviewCount} avis`,
      tone: 'terra' as const,
    },
    {
      label: 'Prochain retrait',
      value: data.nextPickup?.label ?? '—',
      sub: data.nextPickup?.sub ?? 'Aucune commande à retirer',
      tone: 'terra' as const,
    },
  ];

  return (
    <div className="max-w-6xl mx-auto px-8 py-10">
      <header className="mb-8">
        <div className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold">Tableau de bord</div>
        <h1 className="mt-1 font-serif text-[40px] text-green-900 leading-tight">Bonjour {data.firstName} 👋</h1>
        <p className="text-[14px] text-dark/60 mt-1">Voici ce qu&apos;il se passe à {data.producerName} aujourd&apos;hui.</p>
      </header>

      {(data.pendingOrders.length > 0 ||
        data.stockAlerts.length > 0 ||
        data.publicationToDo) && (
        <section className="mb-8">
          <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.16em] text-dark/55">
            À traiter aujourd&apos;hui
          </h2>
          <div className="space-y-2">
            {data.publicationToDo?.kind === 'todo' && (
              <PublicationTodoCard
                doneCount={data.publicationToDo.doneCount}
                missingKeys={data.publicationToDo.missingKeys}
              />
            )}
            {data.publicationToDo?.kind === 'wait' && <PublicationWaitCard />}
            {data.pendingOrders.length > 0 && (
              <Link href="/commandes"
                className="flex items-center justify-between gap-4 p-4 rounded-xl border bg-terra-100/60 border-terra-300/60 hover:bg-terra-100 transition-colors">
                <div className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full bg-terra-700 animate-pulse" />
                  <span className="text-[14px] text-dark font-medium">
                    {data.pendingOrders.length} commande{data.pendingOrders.length > 1 ? 's' : ''} en attente de confirmation
                  </span>
                </div>
                <span className="text-[13px] text-dark/60">Voir →</span>
              </Link>
            )}
            {data.stockAlerts.map((a) => (
              <Link key={a.id} href="/catalogue"
                className="flex items-center justify-between gap-4 p-4 rounded-xl border bg-amber-50 border-amber-200 hover:bg-amber-100/60 transition-colors">
                <div className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  <span className="text-[14px] text-dark font-medium">Stock faible : {a.nom} ({a.stock} restants)</span>
                </div>
                <span className="text-[13px] text-dark/60">Voir →</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        {metrics.map((m) => (
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
          {data.pendingOrders.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6 text-[14px] text-dark/60">
              Aucune commande en attente.
            </div>
          ) : data.pendingOrders.map((p) => (
            <article key={p.id} className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-5">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-[12px] mono text-dark/50">
                    {p.codeCommande && <><span>{p.codeCommande}</span><span>·</span></>}
                    <span>{p.slotLabel}</span>
                  </div>
                  <div className="mt-1 font-serif text-[20px] text-green-900">{p.clientFirstName}</div>
                  <div className="text-[13px] text-dark/70 mt-0.5">{p.itemsSummary}</div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="font-serif text-[20px] text-green-900 tabular-nums">{euros(p.total)}</div>
                    <div className={`text-[11px] mono mt-0.5 ${p.hoursLeft < 6 ? 'text-terra-700 font-semibold' : 'text-dark/50'}`}>
                      ⏱ {p.hoursLeft}h restantes
                    </div>
                  </div>
                  <Link href={`/commandes/${p.id}`}><Button variant="primary" size="sm">Voir</Button></Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="mb-10">
        <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
          <h2 className="font-serif text-[28px] text-green-900 leading-tight">Planning de la semaine</h2>
          <WeekNavigator weekOffset={data.weekOffset} periodLabel={data.weekPeriodLabel} />
        </div>
        <div className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-5">
          <div className="grid grid-cols-7 gap-2">
            {data.weekPlanning.map((d) => (
              <div key={d.day} className={`rounded-xl p-3 min-h-[120px] border ${d.isToday ? 'bg-green-100/60 border-green-500' : 'bg-bg border-dark/[0.06]'}`}>
                <div className={`text-[12px] font-semibold uppercase tracking-wider mb-2 ${d.isToday ? 'text-green-900' : 'text-dark/60'}`}>{d.day}</div>
                <div className="space-y-1.5">
                  {d.slots.length === 0 ? (
                    <div className="text-[11px] text-dark/30 italic">—</div>
                  ) : d.slots.map((s, i) => (
                    <div key={i} className="rounded-md bg-terra-700/10 border border-terra-700/20 p-1.5">
                      <div className="text-[11px] mono text-terra-700 font-semibold">{s.time}</div>
                      <div className="text-[11px] text-dark/70 mt-0.5">{s.orders} cmd.</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <h2 className="font-serif text-[28px] text-green-900 leading-tight mb-1">Badges de fiabilité</h2>
        <p className="text-[13px] text-dark/60 mb-5">Ces badges sont affichés publiquement sur votre page.</p>
        <div className="grid md:grid-cols-3 gap-4">
          {data.badges.map((b) => (
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
  );
}
