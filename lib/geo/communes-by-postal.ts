// Liste des communes d'un code postal via l'API publique geo.api.gouv.fr
// (service public, sans clé). Utilisé pour proposer une SÉLECTION de communes
// au formulaire d'inscription producteur (au lieu d'un champ libre non contrôlé).
//
// Appelé côté SERVEUR depuis /api/communes (POST). Conforme à la doctrine
// garde-fou-autocompletion-cp : aucun log du CP saisi ici (Règle 1), le CP est
// éphémère (Règle 4). Validation stricte du CP avant l'appel réseau, timeout
// dur, branches d'erreur typées (symétrie avec geocode-postal.ts).

const ENDPOINT = "https://geo.api.gouv.fr/communes";
const DEFAULT_TIMEOUT_MS = 8_000;
const POSTAL_CODE_REGEX = /^\d{5}$/;

export type CommunesByPostalErrorCode =
  | "invalid_format"
  | "not_found"
  | "network"
  | "timeout";

export type CommunesByPostalResult =
  | { ok: true; communes: string[] }
  | { ok: false; code: CommunesByPostalErrorCode };

type FetchLike = typeof fetch;

export async function fetchCommunesByPostalCode(
  postalCode: string,
  options: { timeoutMs?: number; fetchImpl?: FetchLike } = {},
): Promise<CommunesByPostalResult> {
  const cp = postalCode.trim();
  if (!POSTAL_CODE_REGEX.test(cp)) {
    return { ok: false, code: "invalid_format" };
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${ENDPOINT}?codePostal=${encodeURIComponent(
    cp,
  )}&fields=nom&format=json`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) return { ok: false, code: "network" };
    const json = (await res.json().catch(() => null)) as
      | Array<{ nom?: string }>
      | null;
    if (!Array.isArray(json)) return { ok: false, code: "network" };

    const communes = Array.from(
      new Set(
        json
          .map((c) => (typeof c.nom === "string" ? c.nom.trim() : ""))
          .filter(Boolean),
      ),
    ).sort((a, b) => a.localeCompare(b, "fr"));

    if (communes.length === 0) return { ok: false, code: "not_found" };
    return { ok: true, communes };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, code: "timeout" };
    }
    return { ok: false, code: "network" };
  } finally {
    clearTimeout(timer);
  }
}
