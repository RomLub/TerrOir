import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getReviewConversationState } from "@/lib/producers/review-conversation-state";
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
// - reviewsToAnswer : avis/conversations où le dernier message vient du client.

export type ProducerNavBadges = {
  ordersToConfirm: number;
  stockRuptures: number;
  reviewsToAnswer: number;
};

export async function fetchProducerNavBadges(
  admin: SupabaseClient,
  producerId: string,
): Promise<ProducerNavBadges> {
  const [ordersRes, alerts, reviewsRes] = await Promise.all([
    admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("producer_id", producerId)
      .eq("statut", "pending"),
    fetchProducerAlerts(admin, producerId).catch(() => []),
    admin
      .from("reviews")
      .select(
        "created_at, published_at, producer_response, producer_response_at, producer_response_updated_at, producer_response_status",
      )
      .eq("producer_id", producerId)
      .eq("statut", "published"),
  ]);

  return {
    ordersToConfirm: ordersRes.count ?? 0,
    stockRuptures: alerts.length,
    reviewsToAnswer:
      reviewsRes.error || !reviewsRes.data
        ? 0
        : reviewsRes.data.filter((review) =>
            getReviewConversationState({
              createdAt: review.created_at as string | null,
              publishedAt: review.published_at as string | null,
              producerResponse: review.producer_response as string | null,
              producerResponseAt: review.producer_response_at as string | null,
              producerResponseUpdatedAt:
                review.producer_response_updated_at as string | null,
              producerResponseStatus: review.producer_response_status as
                | "published"
                | "removed_admin"
                | "removed_producer"
                | null,
              producerReadAt: null,
            }).needsResponse,
          ).length,
  };
}
