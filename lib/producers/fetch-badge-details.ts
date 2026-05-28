import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BADGE_WINDOW_MONTHS } from "@/lib/producers/scoring-constants";
import {
  computeBadgeDetails,
  EMPTY_BADGE_COMPUTATION,
  type BadgeComputation,
  type ScoringOrder,
} from "@/lib/producers/compute-badge-details";

// Fetch + compute des détails badges pour un producteur. Round-trip dédié
// (séparé de la RPC `get_producer_dashboard`) pour exposer les chiffres
// bruts qui sous-tendent chaque score : "X/Y confirmées en ≤ 24 h", etc.
//
// Fail-safe : en cas d'erreur DB (RLS denied, timeout, etc.), retourne
// EMPTY_BADGE_COMPUTATION → l'UI affichera "Pas encore assez de données"
// au lieu de 500. Le score affiché reste celui persisté en table
// producers (déconnecté du recompute live).

export async function fetchBadgeDetailsForProducer(
  admin: SupabaseClient,
  producerId: string,
): Promise<BadgeComputation> {
  const cutoff = new Date();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - BADGE_WINDOW_MONTHS);

  const { data: orders, error } = await admin
    .from("orders")
    .select("statut, created_at, confirmed_at, closure_reason")
    .eq("producer_id", producerId)
    .gte("created_at", cutoff.toISOString());

  if (error) {
    console.error(
      `[BADGE_DETAILS_FETCH_ERR] producer=${producerId} ${error.message}`,
    );
    return EMPTY_BADGE_COMPUTATION;
  }

  if (!orders || orders.length === 0) return EMPTY_BADGE_COMPUTATION;

  return computeBadgeDetails(orders as ScoringOrder[]);
}
