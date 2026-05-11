import { redirect } from 'next/navigation';
import { TZDate } from '@date-fns/tz';
import { getSessionUser } from '@/lib/auth/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { fetchProducerForUser } from '@/lib/producers/context';
import {
  formatSlotRange,
  formatLegacyTimeHHMM,
} from '@/lib/slots/format-slot-time';
import { ProducerLayout } from '../_components/ProducerLayout';
import { DashboardClient, type DashboardData } from './DashboardClient';

const TZ_PARIS = 'Europe/Paris';

// Extrait "YYYY-MM-DD" depuis un ISO timestamptz en Europe/Paris.
// Utilisé pour matcher slots.starts_at au jour iso d'un planning semaine.
function slotDateInParis(iso: string): string {
  const d = new TZDate(iso, TZ_PARIS);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const WEEK_DAYS_LABEL = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function startOfWeek(d: Date): Date {
  const copy = new Date(d);
  const day = (copy.getDay() + 6) % 7; // 0 = Monday
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() - day);
  return copy;
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

export default async function ProducerDashboardPage() {
  const session = await getSessionUser();
  if (!session) redirect('/connexion');

  const supabase = await createSupabaseServerClient();
  const producer = await fetchProducerForUser(supabase, session.id);
  if (!producer) redirect('/invitation');

  const admin = createSupabaseAdminClient();

  const now = new Date();
  const todayStart = startOfDay(now);
  const yesterdayStart = addDays(todayStart, -1);
  const tomorrowStart = addDays(todayStart, 1);
  const weekStart = startOfWeek(now);
  const weekEnd = addDays(weekStart, 7);
  const lastWeekStart = addDays(weekStart, -7);

  // Week planning : slots sont désormais des instances matérialisées avec
  // starts_at/ends_at timestamptz (Phase 1 créneaux). On fetch les slots de
  // la semaine courante avec 1 jour de marge de part et d'autre pour absorber
  // les edge cases TZ (weekStart en UTC vs slots.starts_at en Paris).
  const slotsRangeStart = addDays(weekStart, -1);
  const slotsRangeEnd = addDays(weekEnd, 1);

  // F-045 (audit pré-launch 2026-05-11) — RPC consolidée. Avant : 11 queries
  // Promise.all = 11 conn slots du pooler. Après : 1 RPC SECDEF = 1 conn.
  // Cf. migration 20260511101000_p0_sweep_f045_get_producer_dashboard.sql.
  const { data: dashboard, error: dashboardError } = await admin.rpc(
    'get_producer_dashboard',
    {
      p_producer_id: producer.id,
      p_user_id: session.id,
      p_today_start: todayStart.toISOString(),
      p_yesterday_start: yesterdayStart.toISOString(),
      p_tomorrow_start: tomorrowStart.toISOString(),
      p_week_start: weekStart.toISOString(),
      p_week_end: weekEnd.toISOString(),
      p_last_week_start: lastWeekStart.toISOString(),
      p_slots_range_start: slotsRangeStart.toISOString(),
      p_slots_range_end: slotsRangeEnd.toISOString(),
      p_today_iso: todayStart.toISOString().slice(0, 10),
      p_week_start_iso: weekStart.toISOString().slice(0, 10),
      p_week_end_iso: weekEnd.toISOString().slice(0, 10),
    },
  );

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
    slots?: Array<{ id: string; starts_at: string; ends_at: string }>;
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
  const weekPickups = dash.week_pickups ?? [];
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

  const pickupsBySlotAndDay: Record<string, number> = {};
  (weekPickups ?? []).forEach((p) => {
    if (p.statut === 'cancelled' || p.statut === 'refunded') return;
    if (!p.date_retrait || !p.slot_id) return;
    const k = `${p.date_retrait}|${p.slot_id}`;
    pickupsBySlotAndDay[k] = (pickupsBySlotAndDay[k] ?? 0) + 1;
  });

  const weekPlanning = WEEK_DAYS_LABEL.map((label, i) => {
    const dayDate = addDays(weekStart, i);
    const dayIso = dayDate.toISOString().slice(0, 10);
    const daySlots = (slots ?? [])
      .filter((s) => s.starts_at && slotDateInParis(s.starts_at as string) === dayIso)
      .map((s) => ({
        time: formatSlotRange(s.starts_at as string, s.ends_at as string),
        orders: pickupsBySlotAndDay[`${dayIso}|${s.id as string}`] ?? 0,
      }));
    return {
      day: `${label} ${dayDate.getDate()}`,
      isToday: dayDate.toDateString() === todayStart.toDateString(),
      slots: daySlots,
    };
  });

  const badges: DashboardData['badges'] = [
    {
      kind: 'stock',
      score: Math.round(producerRow?.badge_stock_score ?? 0),
      tip: (producerRow?.badge_stock_score ?? 0) >= 90
        ? 'Excellent. Continuez à actualiser vos stocks après chaque vente.'
        : 'Actualisez vos stocks régulièrement pour éviter les ruptures.',
    },
    {
      kind: 'response',
      score: Math.round(producerRow?.badge_confirmation_score ?? 0),
      tip: (producerRow?.badge_confirmation_score ?? 0) >= 85
        ? 'Très réactif. Vos clients apprécient.'
        : 'Confirmez vos commandes plus rapidement pour atteindre 85+.',
    },
    {
      kind: 'reliability',
      score: Math.round(producerRow?.badge_annulation_score ?? 0),
      tip: (producerRow?.badge_annulation_score ?? 0) >= 95
        ? 'Parfait. Presque aucun désistement.'
        : 'Évitez les annulations côté producteur pour améliorer ce score.',
    },
  ];

  const stockAlerts = (lowStockProducts ?? []).map((p) => ({
    id: p.id as string,
    nom: p.nom as string,
    stock: p.stock_disponible as number,
  }));

  const data: DashboardData = {
    producerId: producer.id,
    producerName: producer.nom_exploitation,
    firstName,
    ordersToday: ordersToday ?? 0,
    ordersYesterday: ordersYesterday ?? 0,
    revenueWeek,
    revenueLastWeek,
    rating: Number(producerRow?.note_moyenne ?? 0),
    reviewCount: producerRow?.nb_avis ?? 0,
    nextPickup,
    pendingOrders,
    weekPlanning,
    badges,
    stockAlerts,
  };

  return (
    <ProducerLayout>
      <DashboardClient data={data} />
    </ProducerLayout>
  );
}
