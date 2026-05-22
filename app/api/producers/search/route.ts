import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { roundCoord } from "@/lib/producers/coords";
import { dbErrorResponse } from "@/lib/api/db-error-response";
import {
  consumeRateLimit,
  getProducersSearchRateLimit,
} from "@/lib/rate-limit";
import { extractRequestContext } from "@/lib/audit-logs/log-auth-event";
import { fetchSearchProducersCached } from "@/lib/producers/search-producers-cached";

// GET /api/producers/search?lat=&lng=&radius=&especes=bovin,ovin&labels=bio
//
// Filtres optionnels : especes (multi-select) + labels (multi-select). Les
// filtres facets score-carbone (mode_elevage / alimentation / densite) ont été
// retirés chantier 3 (2026-05-22).
export async function GET(request: Request) {
  // T-236 : rate-limit IP cap 30/min — anti-trilatération inverse. Couplé
  // au flou roundCoord côté résultats, rend économiquement non rentable
  // une énumération de CPs visant à trianguler l'adresse producteur.
  // Fail-open si Upstash absent (cohérent pattern lib/rate-limit.ts).
  // Pas d'audit log applicatif : pattern T-200 r1 sur les routes publiques
  // anonymes côté géoloc (cf. /api/geocode) — zéro log par-IP côté DB.
  const { ipAddress } = extractRequestContext(request.headers);
  const limiter = getProducersSearchRateLimit();
  const rateResult = await consumeRateLimit(
    limiter,
    ipAddress ?? "anon-no-ip",
  );
  if (!rateResult.success) {
    console.warn(
      `[PRODUCERS_SEARCH_RATE_LIMIT] ip=${ipAddress ?? "(none)"}`,
    );
    return NextResponse.json(
      { error: "Trop de requêtes" },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            Math.max(1, Math.ceil((rateResult.reset - Date.now()) / 1000)),
          ),
        },
      },
    );
  }

  const url = new URL(request.url);
  const lat = parseFloat(url.searchParams.get("lat") ?? "");
  const lng = parseFloat(url.searchParams.get("lng") ?? "");
  const radiusRaw = url.searchParams.get("radius") ?? "50";

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return NextResponse.json(
      { error: "Paramètres lat/lng requis" },
      { status: 400 },
    );
  }

  // `radius=all` (mode « Tous » côté UI carte) : pas de filtre de
  // distance, on passe à la RPC un rayon supérieur à la moitié de la
  // circonférence terrestre (~20 015 km) pour matcher tous les
  // producteurs. La RPC continue de retourner `distance_km` (utile
  // pour le ranking côté UI quand la géoloc est dispo).
  const isUnlimited = radiusRaw === "all";
  const radius = isUnlimited ? 20015 : parseFloat(radiusRaw);

  if (!isUnlimited && (Number.isNaN(radius) || radius <= 0 || radius > 500)) {
    return NextResponse.json(
      { error: "radius hors bornes (1-500 km)" },
      { status: 400 },
    );
  }

  const especes = (url.searchParams.get("especes") ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const labels = (url.searchParams.get("labels") ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  // Filtre bio (chantier 3) : ?bio=1 → uniquement producteurs bio validés.
  const bio = url.searchParams.get("bio") === "1";

  // F-021 (audit pré-launch 2026-05) : la RPC `search_producers` reste
  // coûteuse (sous-requête corrélée products + haversine inline). Pour
  // absorber les pics, on délègue à `fetchSearchProducersCached` qui wrap
  // l'appel dans `unstable_cache` (key quantifiée à 1 décimale ~11 km, TTL
  // 60s, tag `producers-search`). Les flows producer/product appellent
  // `revalidateProducersSearch` après mutation pour la fraîcheur immédiate.
  const admin = createSupabaseAdminClient();
  const { data, error } = await fetchSearchProducersCached(admin, {
    lat,
    lng,
    radius_km: radius,
    especes: especes.length ? especes : null,
    labels: labels.length ? labels : null,
    bio,
  });

  if (error) {
    return dbErrorResponse(error, "PRODUCERS_SEARCH_RPC_ERR", {
      lat,
      lng,
      radius,
    });
  }

  // Sécurité (T-200 r2) : la RPC search_producers retourne les coordonnées
  // brutes des producers (colonnes `latitude` / `longitude` — cf. migration
  // 20260421000000_search_producers_product_count.sql, signature returns
  // table). On floute systématiquement avant exposition côté client pour
  // ne pas leaker l'adresse personnelle du producteur. Cohérent avec le
  // comportement de fetchPublicProducerBySlug pour la fiche publique.
  // NB : l'INPUT lat/lng (querystring visiteur) reste en précision native
  // côté serveur — c'est nécessaire pour la recherche par proximité, hors
  // scope T-200.
  const sanitized = (data ?? []).map((row) => ({
    ...row,
    latitude: roundCoord(row.latitude),
    longitude: roundCoord(row.longitude),
  }));
  return NextResponse.json({ count: sanitized.length, results: sanitized });
}
