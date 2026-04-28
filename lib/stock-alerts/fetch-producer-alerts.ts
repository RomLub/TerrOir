import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Helper de lecture pour le dashboard producer "Alertes stock" (PUSH 5b).
// Retourne pour chaque produit du producer ayant au moins une alerte
// active : { product_id, product_name, count }.
//
// Stratégie 2 requêtes (vs FK embed JOIN) :
//   1. Fetch products (id + nom) du producer.
//   2. Fetch alerts WHERE product_id IN (...) avec filtres actifs.
//   3. Group + count + filter > 0 + tri DESC côté JS.
//
// Justification : table products = ~10-100 lignes par producer max,
// alerts = même ordre de grandeur. Pas besoin d'optimisation SQL JOIN.
// 2 requêtes restent rapides (<10ms en pratique) et sont plus lisibles
// côté code que la syntaxe d'embed Supabase JS.
//
// Filter applicatif producer_id : la table products n'a pas de RLS qui
// scope nativement le producer (les helpers admin sont service-role
// bypass). Le caller (route ou page producer) DOIT vérifier que
// `producerId` correspond au producer authentifié — defense-in-depth
// applicative, pas un check RLS DB.

export interface ProducerAlertCount {
  product_id: string;
  product_name: string;
  count: number;
}

export async function fetchProducerAlerts(
  admin: SupabaseClient,
  producerId: string,
): Promise<ProducerAlertCount[]> {
  // 1. Fetch products du producer
  const { data: productsData, error: productsError } = await admin
    .from("products")
    .select("id, nom")
    .eq("producer_id", producerId);

  if (productsError) {
    console.error(
      `STOCK_ALERT_FETCH_PRODUCER_PRODUCTS_ERROR producer_id=${producerId} error=${productsError.message}`,
    );
    return [];
  }

  const products = (productsData ?? []) as Array<{ id: string; nom: string }>;
  if (products.length === 0) return [];

  const productIds = products.map((p) => p.id);

  // 2. Fetch alertes actives pour ces product_ids
  const { data: alertsData, error: alertsError } = await admin
    .from("product_stock_alerts")
    .select("product_id")
    .in("product_id", productIds)
    .not("confirmed_at", "is", null)
    .is("notified_at", null)
    .is("unsubscribed_at", null);

  if (alertsError) {
    console.error(
      `STOCK_ALERT_FETCH_PRODUCER_ALERTS_ERROR producer_id=${producerId} error=${alertsError.message}`,
    );
    return [];
  }

  const alerts = (alertsData ?? []) as Array<{ product_id: string }>;

  // 3. Group + count
  const counts = new Map<string, number>();
  for (const a of alerts) {
    counts.set(a.product_id, (counts.get(a.product_id) ?? 0) + 1);
  }

  // 4. Build result : produits avec count > 0, tri DESC (plus demandé en haut).
  return products
    .map((p) => ({
      product_id: p.id,
      product_name: p.nom,
      count: counts.get(p.id) ?? 0,
    }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count);
}
