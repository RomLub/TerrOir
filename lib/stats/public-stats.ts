import "server-only";
import { unstable_cache } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Stats agrégées (counts uniquement, zéro donnée personnelle) affichées sur
// la home consumer pour signaler une marketplace active.
//
// Filtres :
//  - producers : statut = 'public' AND deleted_at IS NULL
//  - orders    : statut IN ('confirmed','ready','completed')
//                exclut 'pending' (paiement non finalisé) + 'cancelled' / 'refunded'
//  - products  : active = true AND producer (statut = 'public' AND deleted_at IS NULL)
//
// Fail-open par count : si une requête échoue, on retourne 0 pour ce champ
// + log [PUBLIC_STATS_ERR]. Le composant gère le skip global si tous à 0.
export interface PublicStats {
  producersCount: number;
  ordersCount: number;
  productsCount: number;
}

const COMPLETED_ORDER_STATUSES = ["confirmed", "ready", "completed"] as const;

async function fetchPublicStats(): Promise<PublicStats> {
  const supabase = createSupabaseAdminClient();

  const producersPromise = supabase
    .from("producers")
    .select("id", { count: "exact", head: true })
    .eq("statut", "public")
    .is("deleted_at", null);

  const ordersPromise = supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .in("statut", COMPLETED_ORDER_STATUSES as unknown as string[]);

  // Inner join sur producers : un produit n'est public que si son producer
  // l'est. Filtrer côté joined table via le path "producers.<col>".
  const productsPromise = supabase
    .from("products")
    .select("id, producers!inner(statut, deleted_at)", {
      count: "exact",
      head: true,
    })
    .eq("active", true)
    .eq("producers.statut", "public")
    .is("producers.deleted_at", null);

  const [producersRes, ordersRes, productsRes] = await Promise.all([
    producersPromise,
    ordersPromise,
    productsPromise,
  ]);

  if (producersRes.error) {
    console.error(
      `[PUBLIC_STATS_ERR] producers count failed: ${producersRes.error.message}`,
    );
  }
  if (ordersRes.error) {
    console.error(
      `[PUBLIC_STATS_ERR] orders count failed: ${ordersRes.error.message}`,
    );
  }
  if (productsRes.error) {
    console.error(
      `[PUBLIC_STATS_ERR] products count failed: ${productsRes.error.message}`,
    );
  }

  return {
    producersCount: producersRes.count ?? 0,
    ordersCount: ordersRes.count ?? 0,
    productsCount: productsRes.count ?? 0,
  };
}

// Cache function-level (5 min) : les counts évoluent lentement, pas besoin
// de hit la DB à chaque visite. N'affecte pas la stratégie de cache des
// autres parts de la home.
export const getPublicStats = unstable_cache(fetchPublicStats, ["public-stats"], {
  revalidate: 300,
  tags: ["public-stats"],
});
