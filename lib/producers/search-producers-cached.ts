import "server-only";
import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

// F-021 (audit pré-launch 2026-05 + verification 2026-05-11) : wrapper
// `unstable_cache` sur la RPC `search_producers` pour absorber les pics
// d'appels répétés avec les mêmes paramètres.
//
// La RPC reste coûteuse intrinsèquement (sous-requête corrélée
// `count(*) FROM products WHERE producer_id=wd.id AND active=true` exécutée
// par row, haversine SQL inline `6371 * acos(...)` dans la CTE). À volume
// modéré (<300 producteurs publics) le cache absorbe assez les hits pour
// rester sous la corde. Au-delà, les sous-tasks F-021 phase 2 (colonne
// matérialisée `active_product_count` + trigger) et phase 3 (extension
// `earthdistance` + index GIST) sont reportées au déclencheur volume
// (cf. docs/AUDIT_VERIFICATION_2026-05.md §6.2).
//
// # Stratégie de cache key
//
// La clé inclut les paramètres effectifs de la RPC. lat/lng sont quantifiés
// à 1 décimale (~11 km en latitude, ~7 km en longitude à 47°N) AVANT
// l'appel RPC : deux visiteurs dans le même bassin de vie partagent la même
// entrée de cache.
//
// Trade-off précision assumé : pour un visiteur qui clique sur un point GPS
// arbitraire (geolocation HTML5), les producteurs proposés sont ceux du
// centroïde du bassin de vie de 11 km. En pratique le visiteur saisit un
// code postal qui est déjà géocodé en un point fixe par `geocode_cache` ; le
// binning à 1 décimale ne dégrade rien pour ce flux dominant.
//
// La haversine SQL côté RPC continue de tourner sur des coordonnées
// précises (les bins quantifiés) — le ranking par distance reste
// déterministe. Cohérent avec la doctrine T-200 r1 anti-trilatération
// (binning grossier côté requête, floutage côté résultats par le caller).
//
// # Invalidation
//
// Tag unique `producers-search`. Invalidation via `revalidateProducersSearch`
// (cf. `lib/stats/revalidate.ts`). Appelée par tous les flows qui mutent
// l'état visible côté search :
//   - producer self-update (champs filtre : especes, labels).
//   - producer admin update (mêmes champs).
//   - producer onboarding completion / unpublish (changement de `statut`).
//   - product create / update / toggle active (impacte
//     `count(*) FROM products WHERE active=true`).
//
// # TTL
//
// revalidate=60s : double garde-fou si un flow oublie le `revalidateTag`
// (cas dégradé fail-safe). Aligné `public-products`, `producer-products`,
// `producer-reviews`.

export type SearchProducersParams = {
  lat: number;
  lng: number;
  radius_km: number;
  especes: string[] | null;
  labels: string[] | null;
};

export type SearchProducersRow = {
  latitude: number | null;
  longitude: number | null;
  [key: string]: unknown;
};

// Quantification à 1 décimale (Math.round(v * 10) / 10). Déterministe,
// stateless — pas d'écart de cache key pour la même entrée d'utilisateur,
// pas de fenêtre arbitraire qui trahirait la position exacte par
// requêtes répétées.
function quantizeCoordForCache(v: number): number {
  return Math.round(v * 10) / 10;
}

// Sérialisation déterministe d'une liste de filtres pour la clé de cache.
// Tri lexico + join "|" → deux ordres d'arrivée différents donnent la même
// clé. NULL et liste vide collapsent à "_" pour distinction explicite.
function serializeMultiFilter(values: string[] | null): string {
  if (!values || values.length === 0) return "_";
  return [...values].sort().join("|");
}

// Construit la clé `unstable_cache` à partir des paramètres quantifiés.
// Exportée pour les tests qui veulent vérifier l'égalité de clé entre
// deux appels.
export function buildSearchProducersCacheKey(
  params: SearchProducersParams,
): string[] {
  const binLat = quantizeCoordForCache(params.lat);
  const binLng = quantizeCoordForCache(params.lng);
  return [
    "producers-search",
    `lat=${binLat}`,
    `lng=${binLng}`,
    `radius=${params.radius_km}`,
    `especes=${serializeMultiFilter(params.especes)}`,
    `labels=${serializeMultiFilter(params.labels)}`,
  ];
}

// Wrapper cached de la RPC `search_producers`. Retourne `{ data, error }`
// pour préserver le contrat caller (gestion erreur PostgREST). En cas
// d'erreur RPC, l'entrée n'est pas mémoïsée (Next.js skip cache sur throw,
// donc on retourne `{ data: null, error }` plutôt que throw pour préserver
// la route handler existante).
//
// PRIVACY: opt-out: ce wrapper retourne les coords brutes telles que
// fournies par la RPC `search_producers`. Le floutage `roundCoord` est
// appliqué par le seul caller autorisé (`app/api/producers/search/route.ts`)
// AVANT sérialisation. Le wrapper reste neutre vis-à-vis du floutage pour
// rester utilisable par de futurs callers serveur internes qui auraient
// besoin de la précision native (calcul ranking, audit). Conformité
// T-238 : aucune fuite client, le wrapper n'est pas exporté côté client
// ("server-only" en tête de fichier).
export async function fetchSearchProducersCached(
  admin: SupabaseClient,
  params: SearchProducersParams,
): Promise<{
  data: SearchProducersRow[] | null;
  error: { message: string; code?: string } | null;
}> {
  const cacheKey = buildSearchProducersCacheKey(params);
  const binLat = quantizeCoordForCache(params.lat);
  const binLng = quantizeCoordForCache(params.lng);
  const cached = unstable_cache(
    async () => {
      const { data, error } = await admin.rpc("search_producers", {
        p_lat: binLat,
        p_lng: binLng,
        p_radius_km: params.radius_km,
        p_especes: params.especes,
        p_labels: params.labels,
      });
      if (error) {
        return {
          data: null,
          error: { message: error.message, code: error.code },
        };
      }
      return {
        data: (data ?? []) as SearchProducersRow[],
        error: null,
      };
    },
    cacheKey,
    {
      revalidate: 60,
      tags: ["producers-search"],
    },
  );
  return cached();
}
