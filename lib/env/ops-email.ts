// Fail-fast au module-load : pas de fallback hardcode (cf. CLAUDE.md
// directive "on ne hardcode pas un email perso"). Pattern aligne sur
// lib/env/support-email.ts.
//
// OPS_EMAIL : adresse de l'inbox technique recevant les alertes ops critiques
// (drift Stripe/DB, webhook background errors, refund failed orphelins).
// Distinct de SUPPORT_EMAIL qui recoit les alertes business (transfer.failed,
// dispute, payout). On separe les 2 inboxes pour permettre au support
// (Romain) d'avoir un tri d'inbox prioritaire :
//   - SUPPORT_EMAIL = action requise lente/medium (compta, dispute, KYC)
//   - OPS_EMAIL     = action requise immediate (refund failed, drift DB)
//
// Si OPS_EMAIL n'est pas set, on tombe en fallback sur SUPPORT_EMAIL pour
// ne pas faire echouer le module-load (l'env staging/preview peut ne pas
// avoir OPS_EMAIL distinct). En production tous les 2 doivent etre set.
//
// Cote tests : les fichiers de test qui importent indirectement ce module
// doivent set OPS_EMAIL (ou SUPPORT_EMAIL en fallback) via vi.hoisted().

import { SUPPORT_EMAIL } from "./support-email";

const opsEmail = process.env.OPS_EMAIL ?? SUPPORT_EMAIL;

if (!opsEmail.includes("@")) {
  throw new Error(
    `Invalid OPS_EMAIL env variable: "${opsEmail}". Expected an email address (e.g. 'ops@terroir-local.fr').`,
  );
}

export const OPS_EMAIL: string = opsEmail;
