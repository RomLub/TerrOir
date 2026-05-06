import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { roundCoord } from "@/lib/producers/coords";
import {
  consumeRateLimit,
  getProducersSearchRateLimit,
} from "@/lib/rate-limit";
import { extractRequestContext } from "@/lib/audit-logs/log-auth-event";
import {
  ALIMENTATION_VALUES,
  DENSITE_ANIMALE_VALUES,
  MODE_ELEVAGE_VALUES,
} from "@/lib/producers/score-carbone-enums";

// GET /api/producers/search?lat=&lng=&radius=&especes=bovin,ovin&labels=bio
//   &mode_elevage=plein_air,semi_plein_air&alimentation=pature_dominante
//   &densite_animale=extensive
//
// T-205 : 3 nouveaux filtres optionnels facets score-carbone (multi-select
// virgule-séparé). Validation whitelist côté serveur (rejet silencieux des
// valeurs inconnues — un attaquant qui forge `?mode_elevage=lune` ne casse
// pas la query, simplement ne match rien). RPC search_producers étendue à
// 8 args via migration 20260507410000.
function parseMultiSelect(
  raw: string | null,
  whitelist: readonly string[],
): string[] | null {
  if (!raw) return null;
  const values = raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .filter((v) => whitelist.includes(v));
  return values.length > 0 ? values : null;
}

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
  const radius = parseFloat(url.searchParams.get("radius") ?? "50");

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return NextResponse.json(
      { error: "Paramètres lat/lng requis" },
      { status: 400 },
    );
  }
  if (Number.isNaN(radius) || radius <= 0 || radius > 500) {
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

  // T-205 : facets score-carbone (multi-select). Whitelist Zod-style côté
  // serveur — une valeur inconnue est silencieusement filtrée. Si après
  // filtrage la liste est vide, on passe NULL au RPC (= pas de filtre).
  const modeElevage = parseMultiSelect(
    url.searchParams.get("mode_elevage"),
    MODE_ELEVAGE_VALUES,
  );
  const alimentation = parseMultiSelect(
    url.searchParams.get("alimentation"),
    ALIMENTATION_VALUES,
  );
  const densiteAnimale = parseMultiSelect(
    url.searchParams.get("densite_animale"),
    DENSITE_ANIMALE_VALUES,
  );

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("search_producers", {
    p_lat: lat,
    p_lng: lng,
    p_radius_km: radius,
    p_especes: especes.length ? especes : null,
    p_labels: labels.length ? labels : null,
    p_mode_elevage: modeElevage,
    p_alimentation: alimentation,
    p_densite_animale: densiteAnimale,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
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
  type SearchRow = {
    latitude: number | null;
    longitude: number | null;
    [key: string]: unknown;
  };
  const sanitized = ((data ?? []) as SearchRow[]).map((row) => ({
    ...row,
    latitude: roundCoord(row.latitude),
    longitude: roundCoord(row.longitude),
  }));
  return NextResponse.json({ count: sanitized.length, results: sanitized });
}
