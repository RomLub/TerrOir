// Helper write-cookie côté browser pour le consent RGPD. Posé en module séparé
// pour rester importable depuis 2 composants client (banner + page settings)
// sans duplication.

import {
  COOKIE_CONSENT_MAX_AGE_SECONDS,
  COOKIE_CONSENT_NAME,
  serializeConsent,
  type CookieConsent,
} from "@/lib/rgpd/cookie-consent";

// Domaine apex partagé prod cross-subdomain (cohérent doctrine lib/auth/
// redirect-cookie.ts). En dev (localhost / preview), on laisse le cookie
// scopé au host courant — pas de domain attribute.
const PROD_APEX = "terroir-local.fr";
const PROD_DOMAIN = `.${PROD_APEX}`;

function isProdHost(hostname: string): boolean {
  return hostname === PROD_APEX || hostname.endsWith(PROD_DOMAIN);
}

export function persistConsentInBrowser(consent: CookieConsent): void {
  const value = serializeConsent(consent);
  const hostname =
    typeof window !== "undefined" ? window.location.hostname : "";
  const isProd = isProdHost(hostname);
  const parts = [
    `${COOKIE_CONSENT_NAME}=${value}`,
    "Path=/",
    `Max-Age=${COOKIE_CONSENT_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
  ];
  if (isProd) {
    parts.push(`Domain=${PROD_DOMAIN}`, "Secure");
  }
  document.cookie = parts.join("; ");
}
