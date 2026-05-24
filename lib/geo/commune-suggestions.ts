// Suggestions de communes par préfixe (autocomplétion du code postal) via
// l'API publique api-adresse.data.gouv.fr (autocomplete, sans clé). Dès 2
// caractères saisis, propose des communes avec leur code postal.
//
// Appelé côté SERVEUR depuis POST /api/public/communes/suggest. Conforme à la doctrine
// garde-fou-autocompletion-cp : aucun log du CP/préfixe saisi (Règle 1),
// éphémère (Règle 4). Le cas « autocomplétion CP » y est explicitement prévu
// comme acceptable sous réserve d'un endpoint POST.

const ENDPOINT = "https://api-adresse.data.gouv.fr/search/";
const DEFAULT_TIMEOUT_MS = 6_000;
const DEFAULT_LIMIT = 8;

export type CommuneSuggestion = { code_postal: string; commune: string };

export type CommuneSuggestionsResult =
  | { ok: true; suggestions: CommuneSuggestion[] }
  | { ok: false; code: "invalid_query" | "network" | "timeout" };

type FetchLike = typeof fetch;

export async function fetchCommuneSuggestions(
  query: string,
  options: { timeoutMs?: number; fetchImpl?: FetchLike; limit?: number } = {},
): Promise<CommuneSuggestionsResult> {
  const q = query.trim();
  if (q.length < 2) return { ok: false, code: "invalid_query" };

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const url = `${ENDPOINT}?q=${encodeURIComponent(
    q,
  )}&type=municipality&autocomplete=1&limit=${limit}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) return { ok: false, code: "network" };
    const json = (await res.json().catch(() => null)) as {
      features?: Array<{ properties?: { postcode?: string; name?: string; city?: string } }>;
    } | null;
    const features = json?.features;
    if (!Array.isArray(features)) return { ok: false, code: "network" };

    const seen = new Set<string>();
    const suggestions: CommuneSuggestion[] = [];
    for (const f of features) {
      const code_postal = f.properties?.postcode?.trim() ?? "";
      const commune = (f.properties?.city ?? f.properties?.name ?? "").trim();
      if (!/^\d{5}$/.test(code_postal) || !commune) continue;
      const key = `${code_postal}|${commune}`;
      if (seen.has(key)) continue;
      seen.add(key);
      suggestions.push({ code_postal, commune });
    }
    return { ok: true, suggestions };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, code: "timeout" };
    }
    return { ok: false, code: "network" };
  } finally {
    clearTimeout(timer);
  }
}
