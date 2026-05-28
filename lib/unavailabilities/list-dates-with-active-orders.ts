import { TZDate } from "@date-fns/tz";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ACTIVE_ORDER_STATUTS } from "@/lib/orders/stateMachine";

// Helper server-only utilisé par /creneaux pour pré-charger les jours qui
// portent au moins une commande active. La modale d'indispo désactive
// CLIENT-SIDE ces jours (clic impossible, icône panier ambre, tooltip
// explicite) pour empêcher la rupture d'engagement avant qu'un geste
// délibéré côté /commandes ne soit posé.
//
// Garde serveur indépendante : `createUnavailabilities` (PR #1) renvoie
// déjà { code: 'BLOCKING_ORDERS', blocking_orders } si une requête arrive
// quand même sur un jour à commandes (race, manipulation). L'UI affiche
// alors un message d'erreur explicite — pas un flow d'annulation.

const TZ = "Europe/Paris";

function toParisDateKey(iso: string): string {
  const d = new TZDate(iso, TZ);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Retourne le Set des YYYY-MM-DD Europe/Paris du producteur qui contiennent
// au moins une commande active (pending/confirmed) sur la fenêtre
// [fromKey, toKey] (inclusif). Service_role : appelé après owner check
// dans le caller.
export async function listDatesWithActiveOrders(
  admin: SupabaseClient,
  producerId: string,
  fromKey: string,
  toKey: string,
): Promise<Set<string>> {
  const fromIso = parisDateStartISO(fromKey);
  const toIso = parisDateStartISO(toKey, /*addDays*/ 1); // borne exclusive

  // Stratégie : un join slots ↔ orders côté SQL serait plus efficace, mais
  // PostgREST/Supabase JS ne facilite pas le SELECT depuis slots en
  // filtrant sur orders.statut. On fait deux requêtes : (1) slots du
  // producer dans la fenêtre, (2) orders actives sur ces slot_ids. Pour la
  // fenêtre 90 j d'un producteur typique, ça reste largement sous le ms.
  const { data: slots, error: slotsErr } = await admin
    .from("slots")
    .select("id, starts_at")
    .eq("producer_id", producerId)
    .gte("starts_at", fromIso)
    .lt("starts_at", toIso);
  if (slotsErr || !slots || slots.length === 0) return new Set();

  const slotIds = slots.map((s) => s.id as string);
  const startsBySlot = new Map<string, string>(
    slots.map((s) => [s.id as string, s.starts_at as string]),
  );

  const { data: orders, error: ordersErr } = await admin
    .from("orders")
    .select("slot_id")
    .in("slot_id", slotIds)
    .in("statut", ACTIVE_ORDER_STATUTS as unknown as string[]);
  if (ordersErr || !orders) return new Set();

  const dates = new Set<string>();
  for (const row of orders) {
    const slotId = row.slot_id as string | null;
    if (!slotId) continue;
    const startsAt = startsBySlot.get(slotId);
    if (!startsAt) continue;
    dates.add(toParisDateKey(startsAt));
  }
  return dates;
}

function parisDateStartISO(key: string, addDays = 0): string {
  const [y, m, d] = key.split("-").map(Number);
  return new TZDate(y!, (m ?? 1) - 1, (d ?? 1) + addDays, 0, 0, 0, TZ).toISOString();
}
