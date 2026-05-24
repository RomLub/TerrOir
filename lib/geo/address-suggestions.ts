// Suggestions d'adresses (autocomplétion) via l'API publique
// api-adresse.data.gouv.fr (Base Adresse Nationale, sans clé). Filtrées par
// code postal pour ne proposer que des adresses de la commune saisie.
//
// Appelé côté SERVEUR depuis POST /api/public/address/suggest. Même discipline
// que l'autocomplétion CP (doctrine garde-fou-autocompletion-cp) : requête dans
// le body, aucun log de la saisie, traitement éphémère.

const ENDPOINT = "https://api-adresse.data.gouv.fr/search/";
const DEFAULT_TIMEOUT_MS = 6_000;
const DEFAULT_LIMIT = 6;
const CP_RE = /^\d{5}$/;

export type AddressSuggestion = { label: string; name: string };

export type AddressSuggestionsResult =
  | { ok: true; suggestions: AddressSuggestion[] }
  | { ok: false; code: "invalid_query" | "network" | "timeout" };

type FetchLike = typeof fetch;

export async function fetchAddressSuggestions(
  query: string,
  cp: string,
  options: { timeoutMs?: number; fetchImpl?: FetchLike; limit?: number } = {},
): Promise<AddressSuggestionsResult> {
  const q = query.trim();
  if (q.length < 3 || !CP_RE.test(cp)) {
    return { ok: false, code: "invalid_query" };
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const url = `${ENDPOINT}?q=${encodeURIComponent(
    q,
  )}&postcode=${cp}&autocomplete=1&limit=${limit}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) return { ok: false, code: "network" };
    const json = (await res.json().catch(() => null)) as {
      features?: Array<{ properties?: { label?: string; name?: string } }>;
    } | null;
    const features = json?.features;
    if (!Array.isArray(features)) return { ok: false, code: "network" };

    const seen = new Set<string>();
    const suggestions: AddressSuggestion[] = [];
    for (const f of features) {
      const label = (f.properties?.label ?? "").trim();
      const name = (f.properties?.name ?? "").trim();
      if (!label || !name || seen.has(label)) continue;
      seen.add(label);
      suggestions.push({ label, name });
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
