import "server-only";
import { unstable_cache } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  fetchPublicProducts,
  type PublicProductRow,
  type ResolvedFilters,
} from "./fetch-products-public";
import type { ProductsFilters } from "./parse-search-params";

// Audit Vercel C-5 (2026-05-05) : wrapper cached de fetchPublicProducts
// pour la route /produits, passée de force-dynamic à revalidate=60.
//
// Pattern aligné lib/stats/public-stats.ts → unstable_cache + tag pour
// invalidation ciblée via revalidatePublicProducts. La clé inclut le
// JSON sérialisé des filtres : chaque combinaison (category, animal, cut)
// a sa propre entrée de cache, mais toutes partagent le tag
// 'public-products' — `revalidateTag('public-products')` les invalide
// toutes en bloc lors d'un changement catalogue côté producer.
//
// Revalidate 60s : double garde-fou — si un producer modifie un produit
// sans déclencher revalidatePublicProducts (cas dégradé, fail-safe),
// l'utilisateur verra le changement dans 60s max au lieu d'attendre un
// rebuild Vercel.

export async function getPublicProducts(
  filters: ProductsFilters,
): Promise<{ products: PublicProductRow[]; resolved: ResolvedFilters }> {
  const cacheKey = ["public-products", JSON.stringify(filters)];
  const cached = unstable_cache(
    async () => {
      const admin = createSupabaseAdminClient();
      return fetchPublicProducts(admin, filters);
    },
    cacheKey,
    {
      revalidate: 60,
      tags: ["public-products"],
    },
  );
  return cached();
}
