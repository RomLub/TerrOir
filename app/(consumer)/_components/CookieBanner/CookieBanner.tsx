import { cookies } from "next/headers";
import {
  COOKIE_CONSENT_NAME,
  hasMadeChoice,
  parseConsent,
} from "@/lib/rgpd/cookie-consent";
import { CookieBannerClient } from "./CookieBannerClient";

// =============================================================================
// CookieBanner — server entry, F-012 audit pré-launch 2026-05-10.
// =============================================================================
// Décide si on rend la bannière de consentement. Si l'user a déjà posé un
// choix explicite (cookie terroir-cookie-consent présent et valide), on ne
// rend rien. Sinon on rend le composant client interactif.
//
// ⚠️ NON ACTIVÉ DANS LE LAYOUT pour cette PR. Le commit pose le composant
// prêt-à-l'emploi, l'activation (import dans app/layout.tsx ou similaire)
// est différée au chantier T-201 PostHog. Tant que PostHog n'est pas branché,
// la promesse "uniquement cookies strictement nécessaires" reste tenable
// sans bannière (cf. politique de confidentialité section 6).
// =============================================================================

export async function CookieBanner() {
  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_CONSENT_NAME)?.value ?? null;
  const consent = parseConsent(raw);
  if (hasMadeChoice(consent)) return null;
  return <CookieBannerClient />;
}
