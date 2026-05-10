// =============================================================================
// hasConsent(category) — Wrappers client + server pour lire le cookie de
// consentement RGPD. F-012 audit pré-launch 2026-05-10.
// =============================================================================
// L'helper retourne `false` par défaut (deny-by-default e-Privacy) tant que
// l'user n'a pas posé un choix explicite via la bannière. Les essentials
// retournent toujours `true` (cookies strictement nécessaires au service).
//
// Deux wrappers :
//   - hasConsentClient(category) : lit document.cookie depuis le browser
//   - hasConsentServer(category) : lit cookies() de next/headers côté server
//
// Le helper est imported séparément côté client et côté server car le runtime
// diffère. La logique de parsing est partagée via lib/rgpd/cookie-consent.ts
// (pure, isomorphe).
// =============================================================================

import {
  COOKIE_CONSENT_NAME,
  parseConsent,
  type CookieConsentCategory,
} from "./cookie-consent";

// -----------------------------------------------------------------------------
// Client (browser)
// -----------------------------------------------------------------------------

// Parse document.cookie pour extraire la valeur du cookie de consent.
// Retourne null si absent. Pas de throw — fail-safe.
function readClientCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const cookies = document.cookie.split(";");
  for (const c of cookies) {
    const [k, ...rest] = c.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

export function hasConsentClient(category: CookieConsentCategory): boolean {
  if (category === "essentials") return true;
  const raw = readClientCookie(COOKIE_CONSENT_NAME);
  const consent = parseConsent(raw);
  return consent[category] === true;
}

// -----------------------------------------------------------------------------
// Server (Next.js server component / route handler / server action)
// -----------------------------------------------------------------------------
// L'import dynamique évite que ce module devienne "server-only" au sens
// strict (il est aussi consommé côté client via hasConsentClient). On charge
// next/headers paresseusement, et si l'appel se fait hors d'un scope serveur
// Next (build statique, edge case) on tombe sur les defaults.

export async function hasConsentServer(
  category: CookieConsentCategory,
): Promise<boolean> {
  if (category === "essentials") return true;
  try {
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    const raw = cookieStore.get(COOKIE_CONSENT_NAME)?.value ?? null;
    const consent = parseConsent(raw);
    return consent[category] === true;
  } catch {
    // headers() inaccessible (test, build statique) → deny-by-default cohérent.
    return false;
  }
}
