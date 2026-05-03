// Géocodage code postal → centroïde commune via l'API publique
// api-adresse.data.gouv.fr (service public, sans clé). Appelé directement
// depuis le navigateur du visiteur côté DistanceWidget : aucune donnée ne
// transite par les serveurs TerrOir, aucun log applicatif n'enregistre la
// saisie. Cf. comité review T-200 round 1 (sécurité + RGPD).
//
// Garanties de robustesse :
//   - Validation stricte du CP (regex 5 chiffres) AVANT l'appel réseau —
//     évite tout détournement de l'URL via injection de caractères.
//   - Timeout dur (8s) via AbortController — pas d'état "loading" infini
//     si l'API gouv est lente ou down.
//   - Branches d'erreur typées (invalid_format / not_found / network /
//     timeout) pour que l'UI affiche un message court et chaleureux par
//     cas, sans fuite d'info infrastructure.

const ENDPOINT = "https://api-adresse.data.gouv.fr/search/";
const DEFAULT_TIMEOUT_MS = 8_000;
const POSTAL_CODE_REGEX = /^\d{5}$/;

export type GeocodePostalErrorCode =
  | "invalid_format"
  | "not_found"
  | "network"
  | "timeout";

export type GeocodePostalResult =
  | { ok: true; lat: number; lng: number }
  | { ok: false; code: GeocodePostalErrorCode };

type FetchLike = typeof fetch;

export async function geocodePostalCode(
  postalCode: string,
  options: { timeoutMs?: number; fetchImpl?: FetchLike } = {},
): Promise<GeocodePostalResult> {
  const cp = postalCode.trim();
  if (!POSTAL_CODE_REGEX.test(cp)) {
    return { ok: false, code: "invalid_format" };
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${ENDPOINT}?q=${encodeURIComponent(cp)}&type=municipality&limit=1`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) {
      return { ok: false, code: "network" };
    }
    const json = (await res.json()) as {
      features?: Array<{ geometry?: { coordinates?: [number, number] } }>;
    };
    const coords = json.features?.[0]?.geometry?.coordinates;
    if (!coords || coords.length !== 2) {
      return { ok: false, code: "not_found" };
    }
    const [lng, lat] = coords;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { ok: false, code: "not_found" };
    }
    return { ok: true, lat, lng };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, code: "timeout" };
    }
    return { ok: false, code: "network" };
  } finally {
    clearTimeout(timer);
  }
}

export const GEOCODE_POSTAL_ERROR_MESSAGES: Record<
  GeocodePostalErrorCode,
  string
> = {
  invalid_format: "Code postal invalide (5 chiffres attendus).",
  not_found: "Code postal introuvable.",
  network: "Service de localisation indisponible. Réessaie dans un instant.",
  timeout: "Le service de localisation met trop de temps. Réessaie.",
};
