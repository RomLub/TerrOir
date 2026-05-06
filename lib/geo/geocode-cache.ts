import "server-only";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  geocodePostalCode,
  type GeocodePostalErrorCode,
} from "@/lib/geo/geocode-postal";

// =============================================================================
// T-219 — Cache serveur géocodage CP→lat/lng
// =============================================================================
// Cache persistant Supabase (table public.geocode_cache + 2 RPC) qui amortit
// les appels au géocodeur public api-adresse.data.gouv.fr. Le DistanceWidget
// hit ce cache via la route /api/geocode plutôt que d'appeler gouv.fr en
// direct depuis le navigateur. Cf. docs/fixes/geocode-cache-2026-05-06.md.
//
// Continuité T-200 r1 ("zéro PII traversant, zéro log par-IP, zéro profilage
// user") : le cache stocke uniquement (cp, lat, lng, source, resolved_at,
// hit_count, last_hit_at). Aucune colonne IP, aucune jointure user→cp,
// hit_count = compteur agrégé anonyme. Le CP français est une donnée publique
// INSEE. Aucun log applicatif par-IP côté geocode_cache (le rate-limit Upstash
// reste éphémère côté route, pas tracé long terme côté DB).
//
// Atomicité : les 2 RPC bump_geocode_cache (hit path) et upsert_geocode_cache
// (write path) garantissent l'isolation au niveau row — pas de race condition
// sur hit_count, et resolved_at est préservé sur les UPSERT concurrents.

const CP_REGEX = /^\d{5}$/;
const cpSchema = z.string().trim().regex(CP_REGEX, "invalid_format");

export type ResolvePostalErrorCode = GeocodePostalErrorCode | "db_error";

export type ResolvePostalResult =
  | { ok: true; lat: number; lng: number; cached: boolean; source: string }
  | { ok: false; code: ResolvePostalErrorCode };

type CachedCoords = { lat: number; lng: number };

// -----------------------------------------------------------------------------
// getCachedGeocode — cache hit path (incrémente hit_count + last_hit_at)
// -----------------------------------------------------------------------------
// Appel RPC bump_geocode_cache : UPDATE ... RETURNING en une seule requête,
// atomique. null si cache miss (RETURNING vide).
export async function getCachedGeocode(
  cp: string,
): Promise<CachedCoords | null> {
  const parsed = cpSchema.safeParse(cp);
  if (!parsed.success) return null;

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("bump_geocode_cache", {
    p_cp: parsed.data,
  });

  if (error) {
    console.error(
      `[GEOCODE_CACHE_HIT_ERROR] cp=${parsed.data} error=${error.message}`,
    );
    return null;
  }
  if (!data || (Array.isArray(data) && data.length === 0)) return null;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;

  const lat = Number((row as { lat: number | string }).lat);
  const lng = Number((row as { lng: number | string }).lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

// -----------------------------------------------------------------------------
// setCachedGeocode — cache write path (UPSERT atomique, préserve resolved_at)
// -----------------------------------------------------------------------------
// Appel RPC upsert_geocode_cache : INSERT ... ON CONFLICT DO UPDATE.
// Sur race-condition (2 cache-miss concurrents), le 2e UPSERT incrémente
// hit_count de la row déjà insérée par le 1er.
export async function setCachedGeocode(
  cp: string,
  lat: number,
  lng: number,
  source: string = "api-adresse.data.gouv.fr",
): Promise<boolean> {
  const parsed = cpSchema.safeParse(cp);
  if (!parsed.success) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.rpc("upsert_geocode_cache", {
    p_cp: parsed.data,
    p_lat: lat,
    p_lng: lng,
    p_source: source,
  });

  if (error) {
    console.error(
      `[GEOCODE_CACHE_WRITE_ERROR] cp=${parsed.data} error=${error.message}`,
    );
    return false;
  }
  return true;
}

// -----------------------------------------------------------------------------
// resolvePostalCode — orchestrateur cache hit / miss + fetch externe
// -----------------------------------------------------------------------------
// 1. Validation CP via Zod (5 chiffres, refus tout autre format avant tout I/O).
// 2. Cache hit ? → bump RPC + retour `cached: true`.
// 3. Cache miss ? → fetch api-adresse.data.gouv.fr (lib geocode-postal),
//    UPSERT en cache si succès, retour `cached: false`.
// 4. Erreurs gouv.fr typées (invalid_format / not_found / network / timeout)
//    propagées au caller pour UX précise. Erreur DB → "db_error" propagé
//    seul (cas helper hit retourne null + setCached échoue).
//
// Pas de log par-IP / par-User. Le seul log applicatif est `[GEOCODE_*]` côté
// helpers ci-dessus, qui n'inclut que le CP saisi (donnée publique).
export async function resolvePostalCode(
  cp: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<ResolvePostalResult> {
  const parsed = cpSchema.safeParse(cp);
  if (!parsed.success) {
    return { ok: false, code: "invalid_format" };
  }
  const validCp = parsed.data;

  // Cache hit (incrémente hit_count atomiquement).
  const cached = await getCachedGeocode(validCp);
  if (cached) {
    return {
      ok: true,
      lat: cached.lat,
      lng: cached.lng,
      cached: true,
      source: "geocode_cache",
    };
  }

  // Cache miss : appel api-adresse.data.gouv.fr (helper existant).
  const fetched = await geocodePostalCode(validCp, options);
  if (!fetched.ok) {
    return { ok: false, code: fetched.code };
  }

  // Best-effort persist en cache. Si ça échoue (DB indispo), on ne casse pas
  // la résolution courante : le caller a déjà la réponse géocodée.
  await setCachedGeocode(validCp, fetched.lat, fetched.lng);

  return {
    ok: true,
    lat: fetched.lat,
    lng: fetched.lng,
    cached: false,
    source: "api-adresse.data.gouv.fr",
  };
}
