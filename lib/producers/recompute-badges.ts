import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BADGE_WINDOW_MONTHS } from "@/lib/producers/scoring-constants";
import {
  computeBadgeDetails,
  type ScoringOrder,
} from "@/lib/producers/compute-badge-details";

// Recompute des 3 scores badges pour UN producteur sur une fenêtre glissante
// (cf. BADGE_WINDOW_MONTHS). Logique de calcul extraite dans le helper pur
// `computeBadgeDetails` (réutilisé par /sante et /dashboard pour exposer
// aussi les détails chiffrés). Ce fichier ne fait plus que l'I/O :
// fetch orders → délègue le calcul → persiste les scores.
//
// 3 scores calculés (en pourcentage 0-100, arrondi 2 décimales) :
//   - badge_stock_score        : (total - cancellations stock) / total
//   - badge_confirmation_score : confirmations ≤ CONFIRMATION_THRESHOLD /
//                                total confirmations
//   - badge_annulation_score   : (total - cancellations imputables) / total
//                                où "imputables" = closure_reason ∈
//                                BLAMING_CLOSURE_REASONS.
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

  const { scores, details } = computeBadgeDetails(
    orders as ScoringOrder[],
  );

  const { error: updateError } = await admin
    .from("producers")
    .update(scores)
    .eq("id", producerId);

  if (updateError) {
    return { producer_id: producerId, error: updateError.message };
  }

  return {
    producer_id: producerId,
    total_orders: details.totalOrders,
    ...scores,
  };
}
