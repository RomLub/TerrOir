import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchProducerAlerts } from "@/lib/stock-alerts/fetch-producer-alerts";

// Badges de la sidebar producteur (ADR-0011), mirroir de
// `lib/admin/refunds/fetch.ts` (`fetchRefundsBadgeCount`). Fetchés côté layout
// server, affichés sur les entrées de nav si > 0. Fail-open : toute erreur →
// 0, le badge ne bloque jamais le rendu de la coquille.
//
// - ordersToConfirm : commandes en attente de confirmation (statut 'pending').
//   Même prédicat que l'onglet « À confirmer » de /commandes → cohérence par
//   construction.
// - stockRuptures : nombre de produits ayant au moins une alerte stock active
//   (réutilise `fetchProducerAlerts` → même donnée que la page /alertes-stock).

export type ProducerNavBadges = {
  ordersToConfirm: number;
  stockRuptures: number;
};

export async function fetchProducerNavBadges(
  admin: SupabaseClient,
  producerId: string,
): Promise<ProducerNavBadges> {
  const [ordersRes, alerts] = await Promise.all([
    admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("producer_id", producerId)
      .eq("statut", "pending"),
    fetchProducerAlerts(admin, producerId).catch(() => []),
  ]);

  return {
    ordersToConfirm: ordersRes.count ?? 0,
    stockRuptures: alerts.length,
  };
}
