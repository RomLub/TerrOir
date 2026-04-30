/**
 * Email de support exposé côté client via NEXT_PUBLIC_SUPPORT_EMAIL.
 *
 * Pendant ou en complément de lib/env/support-email.ts (server-only,
 * throw au module-load si env var manquante), ce helper est utilisable
 * depuis du code 'use client' avec un fallback safety pour éviter de
 * casser le runtime client si l'env var n'est pas définie au build.
 *
 * Sémantique distincte de SUPPORT_EMAIL server-only :
 * - Server (lib/env/support-email.ts) : alertes admin techniques
 *   (transfer.failed, payout.failed, dispute) — destinataire interne
 *   (typiquement admin@terroir-local.fr)
 * - Client (ce helper) : mailto user en cas d'erreur checkout —
 *   destinataire support public-facing (typiquement support@terroir-local.fr)
 *
 * Action externe pré-déploiement :
 * - Ajouter NEXT_PUBLIC_SUPPORT_EMAIL au .env.local (dev)
 * - Ajouter NEXT_PUBLIC_SUPPORT_EMAIL aux Vercel env vars (production
 *   / preview / development)
 *
 * Couplage T-443 #75 (consume RPC error hint/details checkout, hardcode
 * SUPPORT_EMAIL_CLIENT remplacé) + T-451 (introduction env var public).
 */
export const SUPPORT_EMAIL_PUBLIC =
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@terroir-local.fr";
