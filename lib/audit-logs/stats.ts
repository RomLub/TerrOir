import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parisCalendarDayBoundsUtc } from "@/lib/format/paris-day-bounds";

// Stats agrégées sur public.audit_logs pour la page admin /audit-logs
// (4 metric cards en haut) + future route /api/admin/audit-logs/stats.
//
// Toutes les bornes "aujourd'hui" / "7 jours" sont calculées en jour
// calendaire Europe/Paris (cohérence reste de l'app : exports, page
// distance, etc.). Pas de cache — l'admin doit voir l'état temps réel.
//
// Lecture via service_role : bypass RLS pour count() agrégé sans rebuilder
// 7 reqs séparées. Au call site, on est déjà sous le check session.isAdmin
// du layout — pas de leak de droits.

const FAILED_PAYMENT_EVENT_TYPES = [
  "order_payment_failed",
  "order_admin_refund_failed",
  "order_producer_refund_failed",
  "order_revival_refund_failed",
  "order_timeout_refund_failed",
  "order_refund_retry_exhausted",
  "stripe_transfer_failed",
  "stripe_payout_failed",
];

export type AuditLogStats = {
  todayCount: number;
  last7daysCount: number;
  topEventType7d: { eventType: string; count: number } | null;
  failed7dCount: number;
};

function todayParisYyyymmdd(now: Date): string {
  // Reuse the same Intl trick que paris-day-bounds, mais en plus simple
  // car on veut juste la date Paris du now, sans bounds aller-retour.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(now);
}

function sevenDaysAgoParisYyyymmdd(now: Date): string {
  // 7 jours glissants, jour J inclus → on borne sur (J-6) 00:00 Paris pour
  // ne pas couper le jour courant en deux. Calcul sur la base de la date
  // Paris pour rester cohérent avec todayParisYyyymmdd même quand le
  // serveur tourne en UTC.
  const todayStr = todayParisYyyymmdd(now);
  const todayMidnightParisAsUtc = parisCalendarDayBoundsUtc(todayStr).startUtc;
  const sevenAgo = new Date(
    todayMidnightParisAsUtc.getTime() - 6 * 24 * 60 * 60 * 1000,
  );
  // Re-projette en date Paris pour récupérer YYYY-MM-DD propre (DST-safe).
  return todayParisYyyymmdd(sevenAgo);
}

export async function getAuditLogStats(now: Date = new Date()): Promise<AuditLogStats> {
  const admin = createSupabaseAdminClient();

  const todayStr = todayParisYyyymmdd(now);
  const todayBounds = parisCalendarDayBoundsUtc(todayStr);
  const sevenStr = sevenDaysAgoParisYyyymmdd(now);
  const sevenStart = parisCalendarDayBoundsUtc(sevenStr).startUtc;

  // Today : count exact, fenêtre [00:00 Paris J, 00:00 Paris J+1[
  const todayRes = await admin
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .gte("created_at", todayBounds.startUtc.toISOString())
    .lt("created_at", todayBounds.endUtc.toISOString());

  // 7 derniers jours : count exact, fenêtre [00:00 Paris J-6, now]
  const last7Res = await admin
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .gte("created_at", sevenStart.toISOString());

  // Failed 7d : count exact restreint au cluster d'échecs payment/refund.
  const failed7Res = await admin
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .gte("created_at", sevenStart.toISOString())
    .in("event_type", FAILED_PAYMENT_EVENT_TYPES);

  // Top event type 7d : on rapatrie les event_type sur la fenêtre puis
  // agrège côté JS. 7 jours d'audit_logs = volume modéré (audit auth
  // ~quelques centaines/jour à mi-2026). Une vraie GROUP BY nécessiterait
  // une RPC dédiée — pas justifié pour 4 metric cards.
  const topRes = await admin
    .from("audit_logs")
    .select("event_type")
    .gte("created_at", sevenStart.toISOString())
    .limit(50_000);

  let topEventType: AuditLogStats["topEventType7d"] = null;
  if (topRes.data && topRes.data.length > 0) {
    const counts = new Map<string, number>();
    for (const row of topRes.data) {
      const t = (row as { event_type: string }).event_type;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    let bestType: string | null = null;
    let bestCount = 0;
    for (const [t, c] of counts) {
      if (c > bestCount) {
        bestCount = c;
        bestType = t;
      }
    }
    if (bestType) {
      topEventType = { eventType: bestType, count: bestCount };
    }
  }

  return {
    todayCount: todayRes.count ?? 0,
    last7daysCount: last7Res.count ?? 0,
    topEventType7d: topEventType,
    failed7dCount: failed7Res.count ?? 0,
  };
}

export const __test__ = {
  todayParisYyyymmdd,
  sevenDaysAgoParisYyyymmdd,
  FAILED_PAYMENT_EVENT_TYPES,
};
