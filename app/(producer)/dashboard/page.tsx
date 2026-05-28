import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { TZDate } from '@date-fns/tz';
import { getSessionUser } from '@/lib/auth/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { fetchProducerForUser, type ProducerRecord } from '@/lib/producers/context';
import { getPublicationStatus } from '@/lib/producers/publication-status';
import type { CriterionKey } from '@/lib/producers/publication-criteria';
import {
  formatSlotRange,
  formatLegacyTimeHHMM,
} from '@/lib/slots/format-slot-time';
import {
  parseWeekOffset,
  computeDashboardBounds,
  formatWeekRangeLabel,
  addDays,
} from '@/lib/dates/week-navigation';
import {
  computeWeekHourRange,
  PLANNING_FALLBACK_RANGE,
} from '@/lib/slots/week-hour-range';
import { fetchBadgeDetailsForProducer } from '@/lib/producers/fetch-badge-details';
import { formatBadgeDetailLine } from '@/lib/producers/compute-badge-details';
import { DashboardSkeleton } from '../_components/ContentSkeletons';
import { DashboardClient, type DashboardData } from './DashboardClient';

type SearchParams = Record<string, string | string[] | undefined>;

// Extrait "YYYY-MM-DD" depuis un ISO timestamptz en Europe/Paris. Utilisé
// pour matcher slots.starts_at au jour iso d'un planning semaine.
function slotDateInParis(iso: string): string {
  const d = new TZDate(iso, TZ_PARIS);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const WEEK_DAYS_LABEL = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const TZ_PARIS = 'Europe/Paris';

// Coquille SYNCHRONE : la page retourne immédiatement le <Suspense> + son
// skeleton, SANS aucun await en tête. Les gardes (session + producteur, ~3
// requêtes) sont déplacées DANS le flux (DashboardGate) pour que le cadre
// (sidebar du layout + skeleton) s'affiche instantanément à chaque navigation
// — fini le flash. Le gros fetch (RPC consolidée) reste streamé.
export default function ProducerDashboardPage(props: {
  searchParams: Promise<SearchParams>;
}) {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardGate searchParamsPromise={props.searchParams} />
    </Suspense>
  );
}

async function DashboardGate({
  searchParamsPromise,
}: {
  searchParamsPromise: Promise<SearchParams>;
}) {
  const searchParams = await searchParamsPromise;
  const session = await getSessionUser();
  if (!session) redirect('/connexion');

  const supabase = await createSupabaseServerClient();
  const producer = await fetchProducerForUser(supabase, session.id);
  if (!producer) redirect('/invitation');

  const weekOffset = parseWeekOffset(searchParams.week);

  return (
    <DashboardContent
      producer={producer}
      userId={session.id}
      weekOffset={weekOffset}
    />
  );
}

async function DashboardContent({
  producer,
  userId,
  weekOffset,
}: {
  producer: ProducerRecord;
  userId: string;
  weekOffset: number;
}) {
  const admin = createSupabaseAdminClient();

  // Navigation par semaine (chantier 10) : `?week=-1` recule d'une semaine,
  // `?week=2` avance de deux. Seules les bornes scopées semaine (planning +
  // revenus semaine + comparaison) suivent l'offset ; les ancres « live »
  // (today/yesterday/tomorrow, prochains retraits, alertes stock) restent
  // sur le vrai now (cf. computeDashboardBounds).
  const now = new Date();
  const bounds = computeDashboardBounds(now, weekOffset);
  const { weekStart, todayStart } = bounds;

  // F-045 (audit pré-launch 2026-05-11) — RPC consolidée. Avant : 11 queries
  // Promise.all = 11 conn slots du pooler. Après : 1 RPC SECDEF = 1 conn.
  // Cf. migration 20260511101000_p0_sweep_f045_get_producer_dashboard.sql.
  //
  // En parallèle : fetch des détails badges (round-trip dédié, ≤ 100 ms
  // sur volume actuel) pour nourrir les sous-titres "X/Y confirmées en
  // ≤ 24 h" sous chaque carte score (chantier scoring cleanup 2026-05-28).
  // Si le volume devient critique, on basculera sur dénormalisation
  // additive — pas le sujet aujourd'hui.
  const [dashboardCall, badgeComputation] = await Promise.all([
    admin.rpc('get_producer_dashboard', {
      p_producer_id: producer.id,
      p_user_id: userId,
      p_today_start: bounds.todayStart.toISOString(),
      p_yesterday_start: bounds.yesterdayStart.toISOString(),
      p_tomorrow_start: bounds.tomorrowStart.toISOString(),
      p_week_start: bounds.weekStart.toISOString(),
      p_week_end: bounds.weekEnd.toISOString(),
      p_last_week_start: bounds.lastWeekStart.toISOString(),
      p_slots_range_start: bounds.slotsRangeStart.toISOString(),
      p_slots_range_end: bounds.slotsRangeEnd.toISOString(),
      p_today_iso: bounds.todayIso,
      p_week_start_iso: bounds.weekStartIso,
      p_week_end_iso: bounds.weekEndIso,
    }),
    fetchBadgeDetailsForProducer(admin, producer.id),
  ]);
  const { data: dashboard, error: dashboardError } = dashboardCall;

  if (dashboardError) {
    console.error(
      `[DASHBOARD_RPC_ERR] producer=${producer.id} message=${dashboardError.message}`,
    );
  }

  const dash = (dashboard ?? {}) as {
    user?: { prenom: string | null; nom: string | null } | null;
    orders_today?: number;
    orders_yesterday?: number;
    week_orders?: Array<{ id: string; montant_total: number | null; statut: string }>;
    last_week_orders?: Array<{ montant_total: number | null; statut: string }>;
    producer_row?: {
      note_moyenne: number | null;
      nb_avis: number | null;
      badge_stock_score: number | null;
      badge_confirmation_score: number | null;
      badge_annulation_score: number | null;
    } | null;
    pending_orders?: Array<{
      id: string;
      code_commande: string | null;
      created_at: string;
      montant_total: number | null;
      date_retrait: string | null;
      consumer: { prenom: string | null } | null;
      slot: { starts_at: string | null; ends_at: string | null } | null;
      order_items: Array<{ nom: string }>;
    }>;
    upcoming_orders?: Array<{
      id: string;
      code_commande: string | null;
      heure_retrait: string | null;
      date_retrait: string | null;
      consumer: { prenom: string | null } | null;
    }>;
    slots?: Array<{
      id: string;
      starts_at: string;
      ends_at: string;
      capacity_per_slot?: number;
      orders_count?: number;
      rule_id?: string | null;
      orders?: Array<{
        order_id: string;
        code_commande: string;
        starts_at: string;
      }>;
    }>;
    week_open_days?: boolean[];
    week_pickups?: Array<{ date_retrait: string | null; slot_id: string | null; statut: string }>;
    low_stock_products?: Array<{
      id: string;
      nom: string;
      stock_disponible: number;
      stock_illimite: boolean;
    }>;
  };

  const user = dash.user ?? null;
  const ordersToday = dash.orders_today ?? 0;
  const ordersYesterday = dash.orders_yesterday ?? 0;
  const weekOrders = dash.week_orders ?? [];
  const lastWeekOrders = dash.last_week_orders ?? [];
  const producerRow = dash.producer_row ?? null;
  const pendingRaw = dash.pending_orders ?? [];
  const upcomingRaw = dash.upcoming_orders ?? [];
  const slots = dash.slots ?? [];
  // Note : `week_pickups` et `week_open_days` ne sont plus consommés. Le
  // compteur de réservations est agrégé côté SQL et exposé par slot dans
  // `slots[].orders_count`. Le nouveau composant VerticalWeekCalendar
  // abolit la notion ouvert/fermé (spec Claude Design). La RPC continue à
  // les retourner pour minimiser le diff return-shape ; un nettoyage SQL
  // pourra les dropper dans un chantier suivant.
  const lowStockProducts = dash.low_stock_products ?? [];

  const firstName = user?.prenom?.trim() || user?.nom?.trim() || 'Pierre';

  const revenueWeek = (weekOrders ?? [])
    .filter((o) => o.statut !== 'cancelled' && o.statut !== 'refunded')
    .reduce((s, o) => s + Number(o.montant_total ?? 0), 0);

  const revenueLastWeek = (lastWeekOrders ?? [])
    .filter((o) => o.statut !== 'cancelled' && o.statut !== 'refunded')
    .reduce((s, o) => s + Number(o.montant_total ?? 0), 0);

  const pendingOrders = pendingRaw.map((o) => {
    const consumer = o.consumer;
    const slot = o.slot;
    const itemNames = (o.order_items ?? [])
      .map((it) => it?.nom ?? '')
      .filter(Boolean);
    const itemsSummary = itemNames.slice(0, 3).join(' · ') + (itemNames.length > 3 ? '…' : '');
    const slotTimeLabel = slot?.starts_at && slot?.ends_at
      ? formatSlotRange(slot.starts_at, slot.ends_at)
      : '—';
    const slotLabel = o.date_retrait
      ? `${new Date(o.date_retrait + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })} · ${slotTimeLabel}`
      : '—';
    const hoursLeft = Math.max(0, 24 - Math.floor((now.getTime() - new Date(o.created_at).getTime()) / 3_600_000));
    return {
      id: o.id,
      codeCommande: o.code_commande,
      clientFirstName: consumer?.prenom?.trim() || 'Client',
      itemsSummary: itemsSummary || '—',
      total: Number(o.montant_total ?? 0),
      slotLabel,
      hoursLeft,
    };
  });

  let nextPickup: DashboardData['nextPickup'] = null;
  if (upcomingRaw.length > 0) {
    const u = upcomingRaw[0]!;
    const consumer = u.consumer;
    const label = formatLegacyTimeHHMM(u.heure_retrait);
    const subDate = u.date_retrait
      ? new Date(u.date_retrait + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
      : '';
    nextPickup = {
      label,
      sub: `${consumer?.prenom ?? 'Client'} · ${u.code_commande ?? ''} · ${subDate}`.trim(),
    };
  }

  // Échelle horaire commune aux 7 colonnes du VerticalWeekCalendar.
  // Calculée ici (serveur Next) pour arriver figée au client. Fallback
  // [8h, 20h] si aucun slot dans la semaine (cf. PLANNING_FALLBACK_RANGE).
  const weekHourRange = computeWeekHourRange(slots ?? []);

  // dateIso utilisé comme clé de jour côté heatmap + drill-down. Construit en
  // heure locale (pas toISOString qui retourne UTC) pour matcher l'horizon
  // de la semaine côté producteur Paris.
  function dayIsoLocal(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  const weekPlanning = WEEK_DAYS_LABEL.map((label, i) => {
    const dayDate = addDays(weekStart, i);
    const dateIso = dayIsoLocal(dayDate);
    const daySlots = (slots ?? [])
      .filter((s) => s.starts_at && slotDateInParis(s.starts_at as string) === dateIso)
      .map((s) => ({
        id: s.id as string,
        starts_at: s.starts_at as string,
        ends_at: s.ends_at as string,
        capacity_per_slot: s.capacity_per_slot ?? 1,
        rule_id: s.rule_id ?? null,
        orders_count: s.orders_count ?? 0,
        orders: s.orders ?? [],
      }));
    return {
      dateIso,
      dayLabel: `${label} ${dayDate.getDate()}`,
      isToday: dayDate.toDateString() === todayStart.toDateString(),
      slots: daySlots,
    };
  });


  const badgeDetails = badgeComputation.details;
  const badges: DashboardData['badges'] = [
    {
      kind: 'stock',
      score: Math.round(producerRow?.badge_stock_score ?? 0),
      tip: (producerRow?.badge_stock_score ?? 0) >= 90
        ? 'Excellent. Continuez à actualiser vos stocks après chaque vente.'
        : 'Actualisez vos stocks régulièrement pour éviter les ruptures.',
      detail: formatBadgeDetailLine('stock', badgeDetails),
    },
    {
      kind: 'response',
      score: Math.round(producerRow?.badge_confirmation_score ?? 0),
      tip: (producerRow?.badge_confirmation_score ?? 0) >= 85
        ? 'Très réactif. Vos clients apprécient.'
        : 'Confirmez vos commandes dans les 24 h pour atteindre 85+.',
      detail: formatBadgeDetailLine('response', badgeDetails),
    },
    {
      kind: 'reliability',
      score: Math.round(producerRow?.badge_annulation_score ?? 0),
      tip: (producerRow?.badge_annulation_score ?? 0) >= 95
        ? 'Parfait. Presque aucune annulation de votre côté.'
        : 'Évitez les annulations de votre côté pour améliorer ce score.',
      detail: formatBadgeDetailLine('reliability', badgeDetails),
    },
  ];

  const stockAlerts = (lowStockProducts ?? []).map((p) => ({
    id: p.id as string,
    nom: p.nom as string,
    stock: p.stock_disponible as number,
  }));

  // Bloc « à traiter » : item publication tant que la fiche n'est pas en ligne
  // (réutilise la RPC lecture seule get_publication_status). Aucun appel quand
  // la fiche est déjà publique. Trois états possibles côté dashboard :
  //   - todo : la fiche n'est pas demandée, on liste les critères restants
  //   - wait : la demande a été envoyée, on attend la validation admin
  //   - null : déjà public, ou ligne producer introuvable (cas pathologique)
  let publicationToDo: DashboardData['publicationToDo'] = null;
  if (producer.statut !== 'public') {
    const pub = await getPublicationStatus(userId);
    if (pub.found && !pub.alreadyPublic) {
      if (pub.publicationRequested) {
        publicationToDo = { kind: 'wait' };
      } else {
        const doneCount = Object.values(pub.criteria).filter(Boolean).length;
        // `pub.missing` est un string[] côté RPC ; on cast vers CriterionKey[]
        // — les valeurs viennent du SQL et matchent strictement les 6 clés.
        publicationToDo = {
          kind: 'todo',
          doneCount,
          missingKeys: pub.missing as CriterionKey[],
        };
      }
    }
  }

  const data: DashboardData = {
    producerId: producer.id,
    producerName: producer.nom_exploitation,
    firstName,
    weekOffset,
    weekPeriodLabel: formatWeekRangeLabel(weekStart),
    ordersToday: ordersToday ?? 0,
    ordersYesterday: ordersYesterday ?? 0,
    revenueWeek,
    revenueLastWeek,
    rating: Number(producerRow?.note_moyenne ?? 0),
    reviewCount: producerRow?.nb_avis ?? 0,
    nextPickup,
    pendingOrders,
    weekPlanning,
    weekHourRange,
    badges,
    stockAlerts,
    publicationToDo,
  };

  return <DashboardClient data={data} />;
}
