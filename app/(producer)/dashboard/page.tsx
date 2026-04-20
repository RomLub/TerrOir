import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { fetchProducerForUser } from '@/lib/producers/context';
import { ProducerLayout } from '../_components/ProducerLayout';
import { DashboardClient, type DashboardData } from './DashboardClient';

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

function formatTimeRange(start: string | null, end: string | null): string {
  const fmt = (t: string) => {
    const [h, m] = t.split(':');
    return m && m !== '00' ? `${parseInt(h, 10)}h${m}` : `${parseInt(h, 10)}h`;
  };
  if (!start) return '—';
  if (!end) return fmt(start);
  return `${fmt(start)}–${fmt(end)}`;
}

export default async function ProducerDashboardPage() {
  const session = await getSessionUser();
  if (!session) redirect('/connexion');

  const supabase = createSupabaseServerClient();
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

  const { data: user } = await admin
    .from('users')
    .select('prenom, nom')
    .eq('id', session.id)
    .maybeSingle();
  const firstName = user?.prenom?.trim() || user?.nom?.trim() || 'Pierre';

  const { count: ordersToday } = await admin
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('producer_id', producer.id)
    .gte('created_at', todayStart.toISOString())
    .lt('created_at', tomorrowStart.toISOString());

  const { count: ordersYesterday } = await admin
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('producer_id', producer.id)
    .gte('created_at', yesterdayStart.toISOString())
    .lt('created_at', todayStart.toISOString());

  const { data: weekOrders } = await admin
    .from('orders')
    .select('id, montant_total, statut')
    .eq('producer_id', producer.id)
    .gte('created_at', weekStart.toISOString())
    .lt('created_at', weekEnd.toISOString());

  const revenueWeek = (weekOrders ?? [])
    .filter((o) => o.statut !== 'cancelled' && o.statut !== 'refunded')
    .reduce((s, o) => s + Number(o.montant_total ?? 0), 0);

  const { data: lastWeekOrders } = await admin
    .from('orders')
    .select('montant_total, statut')
    .eq('producer_id', producer.id)
    .gte('created_at', lastWeekStart.toISOString())
    .lt('created_at', weekStart.toISOString());

  const revenueLastWeek = (lastWeekOrders ?? [])
    .filter((o) => o.statut !== 'cancelled' && o.statut !== 'refunded')
    .reduce((s, o) => s + Number(o.montant_total ?? 0), 0);

  const { data: producerRow } = await admin
    .from('producers')
    .select('note_moyenne, nb_avis, badge_stock_score, badge_confirmation_score, badge_annulation_score')
    .eq('id', producer.id)
    .maybeSingle();

  const { data: pendingRaw } = await admin
    .from('orders')
    .select(`
      id, code_commande, created_at, montant_total, date_retrait,
      consumer:consumer_id ( prenom ),
      slots:slot_id ( heure_debut, heure_fin ),
      order_items ( products:product_id ( nom ) )
    `)
    .eq('producer_id', producer.id)
    .eq('statut', 'pending')
    .order('created_at', { ascending: true })
    .limit(5);

  const pendingOrders = ((pendingRaw ?? []) as unknown as Array<{
    id: string;
    code_commande: string | null;
    created_at: string;
    montant_total: number | null;
    date_retrait: string | null;
    consumer: { prenom: string | null } | Array<{ prenom: string | null }> | null;
    slots: { heure_debut: string | null; heure_fin: string | null } | Array<{ heure_debut: string | null; heure_fin: string | null }> | null;
    order_items: Array<{ products: { nom: string } | Array<{ nom: string }> | null }>;
  }>).map((o) => {
    const consumer = Array.isArray(o.consumer) ? o.consumer[0] : o.consumer;
    const slot = Array.isArray(o.slots) ? o.slots[0] : o.slots;
    const itemNames = (o.order_items ?? []).map((it) => {
      const p = Array.isArray(it.products) ? it.products[0] : it.products;
      return p?.nom ?? '';
    }).filter(Boolean);
    const itemsSummary = itemNames.slice(0, 3).join(' · ') + (itemNames.length > 3 ? '…' : '');
    const slotLabel = o.date_retrait
      ? `${new Date(o.date_retrait + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })} · ${formatTimeRange(slot?.heure_debut ?? null, slot?.heure_fin ?? null)}`
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

  // Next pickup (today or upcoming confirmed/ready)
  const { data: upcomingRaw } = await admin
    .from('orders')
    .select(`
      id, code_commande, heure_retrait, date_retrait,
      consumer:consumer_id ( prenom )
    `)
    .eq('producer_id', producer.id)
    .in('statut', ['confirmed', 'ready'])
    .gte('date_retrait', todayStart.toISOString().slice(0, 10))
    .order('date_retrait', { ascending: true })
    .order('heure_retrait', { ascending: true })
    .limit(1);

  let nextPickup: DashboardData['nextPickup'] = null;
  if (upcomingRaw && upcomingRaw.length > 0) {
    const u = upcomingRaw[0] as unknown as {
      id: string;
      code_commande: string | null;
      heure_retrait: string | null;
      date_retrait: string | null;
      consumer: { prenom: string | null } | Array<{ prenom: string | null }> | null;
    };
    const consumer = Array.isArray(u.consumer) ? u.consumer[0] : u.consumer;
    const label = formatTimeRange(u.heure_retrait, null);
    const subDate = u.date_retrait
      ? new Date(u.date_retrait + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
      : '';
    nextPickup = {
      label,
      sub: `${consumer?.prenom ?? 'Client'} · ${u.code_commande ?? ''} · ${subDate}`.trim(),
    };
  }

  // Week planning
  const { data: slots } = await admin
    .from('slots')
    .select('id, jour_semaine, heure_debut, heure_fin, actif')
    .eq('producer_id', producer.id)
    .eq('actif', true);

  const ordersByDay: Record<string, number> = {};
  (weekOrders ?? []).forEach((o) => {
    const id = (o as { id: string }).id;
    if (!id) return;
  });

  const { data: weekPickups } = await admin
    .from('orders')
    .select('date_retrait, slot_id, statut')
    .eq('producer_id', producer.id)
    .gte('date_retrait', weekStart.toISOString().slice(0, 10))
    .lt('date_retrait', weekEnd.toISOString().slice(0, 10));

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
    const dayOfWeek = dayDate.getDay();
    const daySlots = (slots ?? [])
      .filter((s) => s.jour_semaine === dayOfWeek)
      .map((s) => ({
        time: formatTimeRange(s.heure_debut, s.heure_fin),
        orders: pickupsBySlotAndDay[`${dayIso}|${s.id}`] ?? 0,
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

  const { data: lowStockProducts } = await admin
    .from('products')
    .select('id, nom, stock_disponible, stock_illimite')
    .eq('producer_id', producer.id)
    .eq('actif', true)
    .eq('stock_illimite', false)
    .lte('stock_disponible', 5)
    .gt('stock_disponible', 0)
    .limit(3);

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
