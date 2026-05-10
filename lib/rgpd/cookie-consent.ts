// =============================================================================
// Cookie de consentement RGPD / e-Privacy — F-012 audit pré-launch 2026-05-10.
// =============================================================================
// Stocke les choix de l'utilisateur sur les 3 catégories de cookies (essentiels,
// analytics, marketing). Préparation pour le chantier T-201 PostHog event
// tracking — la bannière n'est PAS encore activée dans le layout consumer
// (commit "préparation"). Tant que le composant n'est pas mounted, le helper
// `hasConsent` retourne `false` pour analytics + marketing par défaut, ce qui
// bloque tout script analytics (pattern e-Privacy : opt-in explicite requis).
//
// Format cookie (URL-encoded JSON, lisible par le browser et le server) :
//   {"v":"1","essentials":true,"analytics":false,"marketing":false,
//    "updated_at":"2026-05-10T12:00:00.000Z"}
//
// Rationnel cookie HTTP plutôt que localStorage :
//   - Lisible côté server (next/headers cookies()) → permet de gater le rendu
//     SSR de scripts analytics avant qu'ils ne s'exécutent côté browser.
//   - Cross-subdomain via domain=.terroir-local.fr (cohérent doctrine TerrOir
//     pour cookies non-auth, cf. lib/auth/redirect-cookie.ts).
//   - Persistance 13 mois (recommandation CNIL pour cookies analytics opt-in).
//
// Pas de prefix __Secure- : ce cookie n'est pas un secret, juste une
// préférence utilisateur. Le composant côté browser doit pouvoir le lire et
// l'écrire en JS — incompatible avec HttpOnly. Pour la sécurité, le contenu
// est validé Zod côté server (parse défensif) avant utilisation.
// =============================================================================

export const COOKIE_CONSENT_NAME = "terroir-cookie-consent";

// 13 mois CNIL — recommandation officielle pour la durée de vie des cookies
// analytics opt-in (au-delà, demander à nouveau le consentement).
export const COOKIE_CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 30 * 13;

export const COOKIE_CONSENT_VERSION = "1";

export type CookieConsentCategory = "essentials" | "analytics" | "marketing";

export const COOKIE_CONSENT_CATEGORIES: readonly CookieConsentCategory[] = [
  "essentials",
  "analytics",
  "marketing",
] as const;

export type CookieConsent = {
  v: string;
  essentials: boolean;
  analytics: boolean;
  marketing: boolean;
  updated_at: string; // ISO 8601
};

// Defaults : aucune catégorie autorisée à part les essentiels (toujours actifs,
// non-désactivables par l'user — ils sont strictement nécessaires au service).
// Tant que l'user n'a pas posé son choix explicite, analytics + marketing sont
// bloqués par hasConsent (défense en profondeur).
export const DEFAULT_CONSENT: Readonly<CookieConsent> = {
  v: COOKIE_CONSENT_VERSION,
  essentials: true,
  analytics: false,
  marketing: false,
  updated_at: "1970-01-01T00:00:00.000Z",
};

// Sérialise un consent en string URL-safe pour le stocker en cookie.
// JSON minifié + encodeURIComponent. Pas de base64 (lisibilité debug + plus
// court pour les cas typiques).
export function serializeConsent(consent: CookieConsent): string {
  return encodeURIComponent(JSON.stringify(consent));
}

// Parse défensif : si le cookie est absent / corrompu / d'une version
// inconnue / mal formé, retourne les defaults (deny-by-default cohérent
// e-Privacy). Jamais de throw, jamais de partial — soit le consent est
// valide, soit on retourne defaults.
export function parseConsent(raw: string | null | undefined): CookieConsent {
  if (!raw) return { ...DEFAULT_CONSENT };
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return { ...DEFAULT_CONSENT };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return { ...DEFAULT_CONSENT };
  }
  if (!parsed || typeof parsed !== "object") return { ...DEFAULT_CONSENT };
  const obj = parsed as Record<string, unknown>;
  if (obj.v !== COOKIE_CONSENT_VERSION) return { ...DEFAULT_CONSENT };
  return {
    v: COOKIE_CONSENT_VERSION,
    essentials: true, // toujours forcé true — non-désactivable par l'user.
    analytics: obj.analytics === true,
    marketing: obj.marketing === true,
    updated_at:
      typeof obj.updated_at === "string"
        ? obj.updated_at
        : DEFAULT_CONSENT.updated_at,
  };
}

// Helper de bascule par catégorie. Exposé pour la modal "Personnaliser".
// Les essentials sont ignorés (toujours true) côté UI ET côté write — un
// user ne peut pas désactiver les cookies de session par exemple.
export function buildConsent(
  partial: { analytics?: boolean; marketing?: boolean },
  now: Date = new Date(),
): CookieConsent {
  return {
    v: COOKIE_CONSENT_VERSION,
    essentials: true,
    analytics: partial.analytics === true,
    marketing: partial.marketing === true,
    updated_at: now.toISOString(),
  };
}

// Presets bouton "Tout accepter" / "Tout refuser" pour la bannière.
export function acceptAllConsent(now: Date = new Date()): CookieConsent {
  return buildConsent({ analytics: true, marketing: true }, now);
}

export function rejectAllConsent(now: Date = new Date()): CookieConsent {
  return buildConsent({ analytics: false, marketing: false }, now);
}

// Vérifie si l'user a déjà posé un choix explicite (= pas le default initial).
// Utile pour décider si on affiche la bannière ou pas.
export function hasMadeChoice(consent: CookieConsent): boolean {
  return consent.updated_at !== DEFAULT_CONSENT.updated_at;
}
