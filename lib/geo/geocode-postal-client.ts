// Helper client (navigateur uniquement) pour résoudre un CP via la route
// serveur /api/geocode (T-219). Remplace l'appel direct au géocodeur public
// `geocodePostalCode` côté DistanceWidget par un fetch interne TerrOir, ce
// qui amortit les hits gouv.fr via le cache Supabase `geocode_cache` (T-204).
//
// Continuité T-200 r1 : la requête traverse maintenant nos serveurs, mais
//   - aucun audit log applicatif (pas d'entrée dans audit_logs),
//   - rate-limit Upstash éphémère (window 60s),
//   - aucune jointure user→cp côté DB,
//   - hit_count agrégé anonyme dans geocode_cache.
// Cf. docs/fixes/geocode-cache-2026-05-06.md section "Continuité T-200 r1".
//
// API symétrique avec `geocodePostalCode` (lib/geo/geocode-postal.ts) pour
// limiter le diff côté DistanceWidget — même type de retour `GeocodePostalResult`,
// mêmes codes d'erreur (étendus avec rate_limited / upstream_unavailable
// émis par la route serveur).

import {
  type GeocodePostalErrorCode,
  type GeocodePostalResult,
} from "@/lib/geo/geocode-postal";

const ENDPOINT = "/api/geocode";
const DEFAULT_TIMEOUT_MS = 8_000;
const POSTAL_CODE_REGEX = /^\d{5}$/;

type FetchLike = typeof fetch;

type GeocodeApiSuccess = {
  ok: true;
  lat: number;
  lng: number;
  cached?: boolean;
  source?: string;
};

type GeocodeApiFailure = {
  ok: false;
  code: GeocodePostalErrorCode;
};

export async function geocodePostalCodeViaApi(
  postalCode: string,
  options: { timeoutMs?: number; fetchImpl?: FetchLike } = {},
): Promise<GeocodePostalResult> {
  const cp = postalCode.trim();
  // Validation côté client préalable au fetch — symétrie avec
  // geocodePostalCode + court-circuit avant l'appel réseau.
  if (!POSTAL_CODE_REGEX.test(cp)) {
    return { ok: false, code: "invalid_format" };
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${ENDPOINT}?cp=${encodeURIComponent(cp)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    const json = (await res.json().catch(() => null)) as
      | GeocodeApiSuccess
      | GeocodeApiFailure
      | null;

    if (res.ok && json && json.ok === true) {
      const lat = Number(json.lat);
      const lng = Number(json.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return { ok: false, code: "not_found" };
      }
      return { ok: true, lat, lng };
    }

    if (json && json.ok === false && typeof json.code === "string") {
      return { ok: false, code: json.code };
    }
    return { ok: false, code: "network" };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, code: "timeout" };
    }
    return { ok: false, code: "network" };
  } finally {
    clearTimeout(timer);
  }
}
