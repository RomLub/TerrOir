import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BADGE_WINDOW_MONTHS,
  BLAMING_CLOSURE_REASONS,
  CONFIRMATION_THRESHOLD_MS,
} from "@/lib/producers/scoring-constants";

// Recompute des 3 scores badges pour UN producteur sur une fenêtre glissante
// (cf. BADGE_WINDOW_MONTHS). Logique extraite de l'ancienne route PATCH
// /api/producers/[id]/badges supprimée par T-417.
//
// 3 scores calculés (en pourcentage 0-100, arrondi 2 décimales) :
//   - badge_stock_score        : (total - cancellations stock) / total
//   - badge_confirmation_score : confirmations ≤ CONFIRMATION_THRESHOLD /
//                                total confirmations
//   - badge_annulation_score   : (total - cancellations imputables) / total
//                                où "imputables" = closure_reason ∈
//                                BLAMING_CLOSURE_REASONS. Les annulations
//                                externes au producteur (consumer_cancel,
//                                timeout, payment_failed, revival_blocked_*)
//                                ne pénalisent plus son score.
//
// Pas d'appel notification ni email : pure DB recompute.

export type RecomputeBadgesResult = {
  producer_id: string;
  reason?: "no_orders";
  total_orders?: number;
  badge_stock_score?: number;
  badge_confirmation_score?: number;
  badge_annulation_score?: number;
  error?: string;
};

export async function recomputeBadgesForProducer(
  admin: SupabaseClient,
  producerId: string,
): Promise<RecomputeBadgesResult> {
  const cutoff = new Date();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - BADGE_WINDOW_MONTHS);

  const { data: orders, error: selectError } = await admin
    .from("orders")
    .select("id, statut, created_at, confirmed_at, closure_reason")
    .eq("producer_id", producerId)
    .gte("created_at", cutoff.toISOString());

  if (selectError) {
    return { producer_id: producerId, error: selectError.message };
  }

  if (!orders || orders.length === 0) {
    return { producer_id: producerId, reason: "no_orders" };
  }

  const total = orders.length;
  const cancelledStock = orders.filter(
    (o) => o.closure_reason === "stock",
  ).length;
  // Annulations "imputables" : seules celles dont closure_reason est dans
  // BLAMING_CLOSURE_REASONS (producer_cancel, stock). Le statut seul ne
  // suffit pas — un consumer_cancel ou un timeout cron a aussi statut
  // 'cancelled'/'refunded' mais ne doit pas pénaliser le producteur.
  const cancelled = orders.filter(
    (o) =>
      (o.statut === "cancelled" || o.statut === "refunded") &&
      (BLAMING_CLOSURE_REASONS as readonly string[]).includes(
        o.closure_reason ?? "",
      ),
  ).length;
  const confirmed = orders.filter((o) => o.confirmed_at !== null);
  const fastConfirmed = confirmed.filter((o) => {
    if (!o.created_at || !o.confirmed_at) return false;
    return (
      new Date(o.confirmed_at).getTime() - new Date(o.created_at).getTime() <=
      CONFIRMATION_THRESHOLD_MS
    );
  }).length;

  const pct = (x: number, y: number) =>
    y === 0 ? 100 : Math.round(((x / y) * 100) * 100) / 100;

  const scores = {
    badge_stock_score: pct(total - cancelledStock, total),
    badge_confirmation_score: pct(fastConfirmed, Math.max(confirmed.length, 1)),
    badge_annulation_score: pct(total - cancelled, total),
  };

  const { error: updateError } = await admin
    .from("producers")
    .update(scores)
    .eq("id", producerId);

  if (updateError) {
    return { producer_id: producerId, error: updateError.message };
  }

  return {
    producer_id: producerId,
    total_orders: total,
    ...scores,
  };
}
