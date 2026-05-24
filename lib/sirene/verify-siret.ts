// Vérification d'existence d'un SIRET via l'API publique ouverte
// recherche-entreprises.api.gouv.fr (annuaire des entreprises, sans clé).
//
// Usage : couche anti-fausse-identité (étape 2 onboarding producteur). NON
// bloquant — sert à confirmer qu'une entreprise réelle existe et à récupérer
// son nom légal pour recoupement (nom déclaré ↔ nom légal ↔ identité Stripe
// KYC). La validation forte de l'identité reste Stripe Connect ; ici on ne fait
// que confirmer/infirmer l'existence du numéro et nourrir la revue admin.
//
// Le SIRET est une donnée d'entreprise publique (pas une donnée personnelle au
// sens RGPD) : pas de contrainte de la doctrine garde-fou-cp. On passe quand
// même par POST côté route + rate-limit (protection de l'API amont).

import type { FormeJuridique } from "@/lib/auth/validators";

const ENDPOINT = "https://recherche-entreprises.api.gouv.fr/search";
const DEFAULT_TIMEOUT_MS = 6_000;

// Catégorie juridique INSEE (niveau III, champ `nature_juridique`) → option du
// formulaire. Codes vérifiés sur l'API : EI=1000, SAS=5710/SASU=5720,
// SARL=5499/EURL=5498, GAEC=6533, EARL=6598, SCEA=6597. Code inconnu → on ne
// présélectionne rien (l'utilisateur choisit). Présélection indicative,
// modifiable.
const NATURE_TO_FORME: Record<string, FormeJuridique> = {
  "1000": "ei",
  "5710": "sas",
  "5720": "sas",
  "5499": "sarl",
  "5498": "sarl",
  "6533": "gaec",
  "6598": "earl",
  "6597": "scea",
};

export type SiretVerification =
  | { ok: true; found: true; legalName: string; formeJuridique?: FormeJuridique }
  | { ok: true; found: false }
  | { ok: false; code: "invalid_format" | "network" | "timeout" };

type FetchLike = typeof fetch;

type SearchResult = {
  nom_complet?: string;
  nom_raison_sociale?: string;
  nature_juridique?: string;
  siege?: { siret?: string };
  matching_etablissements?: Array<{ siret?: string }>;
};

export async function verifySiret(
  siret: string,
  options: { timeoutMs?: number; fetchImpl?: FetchLike } = {},
): Promise<SiretVerification> {
  const cleaned = siret.replace(/\s/g, "");
  if (!/^\d{14}$/.test(cleaned)) return { ok: false, code: "invalid_format" };

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${ENDPOINT}?q=${cleaned}&per_page=1`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) return { ok: false, code: "network" };
    const json = (await res.json().catch(() => null)) as {
      results?: SearchResult[];
    } | null;
    const results = json?.results;
    if (!Array.isArray(results)) return { ok: false, code: "network" };

    // L'établissement exact doit figurer parmi les résultats (siège ou
    // établissement secondaire matché par la recherche full-text).
    const match = results.find(
      (r) =>
        r.siege?.siret === cleaned ||
        (r.matching_etablissements ?? []).some((e) => e.siret === cleaned),
    );
    if (!match) return { ok: true, found: false };

    const legalName = (match.nom_complet ?? match.nom_raison_sociale ?? "").trim();
    const formeJuridique = match.nature_juridique
      ? NATURE_TO_FORME[match.nature_juridique]
      : undefined;
    return { ok: true, found: true, legalName, formeJuridique };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, code: "timeout" };
    }
    return { ok: false, code: "network" };
  } finally {
    clearTimeout(timer);
  }
}
