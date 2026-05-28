import type { SupabaseClient } from '@supabase/supabase-js';
import { TZDate } from '@date-fns/tz';
import { addDays } from 'date-fns';
import { ACTIVE_ORDER_STATUTS } from '@/lib/orders/stateMachine';
import { formatOrderNumber } from '@/lib/orders/order-number';
import type { BlockingOrderForUnavail } from './types';

const TZ = 'Europe/Paris';

// Convertit "YYYY-MM-DD" → ISO UTC du début du jour Europe/Paris (00:00 Paris).
function parisDateStart(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new TZDate(y!, (m ?? 1) - 1, d ?? 1, 0, 0, 0, TZ).toISOString();
}

// Détecte les commandes actives (pending/confirmed) qui empêchent la pose
// d'une indispo sur l'une des dates fournies. Service_role : l'ownership a
// déjà été vérifié en amont par la server action.
//
// Stratégie :
//   1) Fetch les slot ids du producteur sur les jours [date, date+1[ en UTC.
//   2) Fetch les orders actives sur ces slot ids, avec jointures consumer +
//      slot (starts_at/ends_at) + producer (producer_number pour
//      `numero_commande`).
//   3) Mappe vers BlockingOrderForUnavail en re-calculant `date_key` côté
//      app (single source of truth Europe/Paris).
//
// Renvoie `[]` si aucun blocking, ou tableau ordonné chronologiquement par
// slot_starts_at. L'UI calendaire affichera "Annuler et fermer" sur le set
// pour réutiliser le pattern PR #198.
export async function detectBlockingOrdersForDates(
  admin: SupabaseClient,
  producerId: string,
  dateKeys: string[],
): Promise<BlockingOrderForUnavail[]> {
  if (dateKeys.length === 0) return [];

  const uniqueDays = Array.from(new Set(dateKeys));

  // 1. Slots du producteur sur ces jours (bornes UTC pour chaque jour).
  type SlotRow = { id: string; starts_at: string; ends_at: string };
  const slots: SlotRow[] = [];
  for (const day of uniqueDays) {
    const startBoundary = parisDateStart(day);
    const endBoundary = addDays(new Date(startBoundary), 1).toISOString();
    const { data, error } = await admin
      .from('slots')
      .select('id, starts_at, ends_at')
      .eq('producer_id', producerId)
      .gte('starts_at', startBoundary)
      .lt('starts_at', endBoundary);
    if (error) {
      console.warn(
        `DETECT_BLOCKING_ORDERS slots fetch error producer_id=${producerId} day=${day} error=${error.message}`,
      );
      continue;
    }
    if (data) slots.push(...(data as SlotRow[]));
  }

  if (slots.length === 0) return [];

  const slotIds = slots.map((s) => s.id);
  const slotById = new Map(slots.map((s) => [s.id, s]));

  // 2. Orders actives sur ces slot ids.
  const { data: orders, error: ordersErr } = await admin
    .from('orders')
    .select(
      'id, slot_id, producer_order_seq, montant_total, consumer:users!orders_consumer_id_fkey(prenom), producer:producers!orders_producer_id_fkey(producer_number)',
    )
    .in('slot_id', slotIds)
    .in('statut', ACTIVE_ORDER_STATUTS as unknown as string[])
    .order('created_at', { ascending: true });

  if (ordersErr || !orders) {
    if (ordersErr) {
      console.warn(
        `DETECT_BLOCKING_ORDERS orders fetch error producer_id=${producerId} error=${ordersErr.message}`,
      );
    }
    return [];
  }

  // 3. Mapping → BlockingOrderForUnavail.
  return orders.map((row) => {
    const consumer = Array.isArray(row.consumer) ? row.consumer[0] : row.consumer;
    const producer = Array.isArray(row.producer) ? row.producer[0] : row.producer;
    const producerNumber =
      (producer as { producer_number: number } | null)?.producer_number ?? 0;
    const slot = slotById.get(row.slot_id as string);
    const startsAt = slot?.starts_at ?? '';
    const endsAt = slot?.ends_at ?? '';
    // Re-calcule le date_key Europe/Paris depuis le starts_at ISO du slot.
    const dateKey = startsAt ? toParisDateKey(startsAt) : '';
    return {
      id: row.id as string,
      numero_commande: formatOrderNumber(
        producerNumber,
        (row.producer_order_seq as number) ?? 0,
      ),
      consumer_prenom:
        (consumer as { prenom: string | null } | null)?.prenom ?? null,
      montant_total: Number(row.montant_total ?? 0),
      slot_starts_at: startsAt,
      slot_ends_at: endsAt,
      date_key: dateKey,
    };
  });
}

// Helper local : ISO UTC → YYYY-MM-DD Europe/Paris.
function toParisDateKey(iso: string): string {
  const day = new TZDate(iso, TZ);
  const y = day.getFullYear();
  const m = String(day.getMonth() + 1).padStart(2, '0');
  const d = String(day.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
