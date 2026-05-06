import { NextResponse } from "next/server";
import { z } from "zod";
import {
  consumeRateLimit,
  getGeocodeRateLimit,
} from "@/lib/rate-limit";
import { extractRequestContext } from "@/lib/audit-logs/log-auth-event";
import { resolvePostalCode } from "@/lib/geo/geocode-cache";

// =============================================================================
// GET /api/geocode?cp=XXXXX — T-219
// =============================================================================
// Route serveur intermédiaire qui mediates les appels du DistanceWidget vers
// api-adresse.data.gouv.fr en cachant les résultats côté serveur (table
// public.geocode_cache, cf. lib/geo/geocode-cache.ts).
//
// Continuité T-200 r1 ("zéro PII traversant, zéro log par-IP, zéro profilage
// user") :
//   - Aucun audit log applicatif (pas d'entrée dans audit_logs).
//   - Aucune jointure user→cp côté DB. Le rate-limit identifier IP est
//     éphémère (Upstash KV avec window 60s, purgé automatiquement).
//   - Pas de log par-IP côté geocode_cache (pas de colonne IP dans la table).
//   - Le seul log applicatif possible est le warn console rate-limit hit, qui
//     est cohérent avec le pattern /api/contact (page publique).
//
// Cache HTTP 30 jours en cas de succès : defense in depth, le navigateur peut
// court-circuiter la route si le CP a déjà été résolu côté client (les CP
// français ne bougent pas). Cohérent avec la persistance permanente côté DB.
//
// Codes retour :
//   200 — { lat, lng, cached: boolean, source: string }
//   400 — { ok:false, code:"invalid_format" }      (CP non conforme regex)
//   404 — { ok:false, code:"not_found" }            (CP introuvable côté gouv.fr)
//   429 — { ok:false, code:"rate_limited" }         (cap Upstash 30/min/IP)
//   502 — { ok:false, code:"upstream_unavailable" } (gouv.fr down + cache miss)

const querySchema = z.object({
  cp: z.string().trim().regex(/^\d{5}$/),
});

const CACHE_HEADER = "public, max-age=2592000, immutable"; // 30 jours

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ cp: url.searchParams.get("cp") });
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: "invalid_format" },
      { status: 400 },
    );
  }

  // Rate-limit IP (cap 30/min). Fail-open si Upstash absent.
  const { ipAddress } = extractRequestContext(request.headers);
  const limiter = getGeocodeRateLimit();
  const rateResult = await consumeRateLimit(
    limiter,
    ipAddress ?? "anon-no-ip",
  );
  if (!rateResult.success) {
    console.warn(`[GEOCODE_RATE_LIMIT] ip=${ipAddress ?? "(none)"}`);
    return NextResponse.json(
      { ok: false, code: "rate_limited" },
      { status: 429 },
    );
  }

  const result = await resolvePostalCode(parsed.data.cp);

  if (result.ok) {
    return NextResponse.json(
      {
        ok: true,
        lat: result.lat,
        lng: result.lng,
        cached: result.cached,
        source: result.source,
      },
      { status: 200, headers: { "Cache-Control": CACHE_HEADER } },
    );
  }

  // Mapping erreurs typées → codes HTTP. invalid_format ne devrait jamais
  // arriver ici (déjà filtré par Zod plus haut) mais on garde la cohérence.
  const status =
    result.code === "invalid_format" ? 400
      : result.code === "not_found"     ? 404
      : 502; // network / timeout / db_error
  const body =
    status === 502
      ? { ok: false, code: "upstream_unavailable" as const }
      : { ok: false, code: result.code };
  return NextResponse.json(body, { status });
}
