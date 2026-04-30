// Callbacks dédiés aux flows Supabase Auth qui envoient un email avec
// emailRedirectTo (magic link, change email, password reset). Le rôle dicte
// le host :
//   admin → admin.terroir-local.fr (cookies isolés)
//   autres (consumer + producer) → www.terroir-local.fr (cookies partagés
//     .terroir-local.fr couvrent pro)
//
// Source unique vs duplication entre flows. Aligné sur magic link
// (cf. requestMagicLinkAction) et password reset (cf. requestPasswordResetAction).
// Note T-013 PR2 : le change_email ne passe plus par ce helper — il utilise
// désormais un flow custom 2 OTP successifs (cf. _actions/request-otp,
// verify-otp, complete-email-change) sans emailRedirectTo.
//
// URLs construites au module-load depuis NEXT_PUBLIC_APP_URL et
// NEXT_PUBLIC_ADMIN_URL (T-328) — env vars inlinées par Next.js au build,
// donc :
//   * preview-aware : un déploiement preview Vercel peut surcharger les vars
//     pour pointer sur ses propres hosts (testabilité Change Email / Magic
//     Link / Reset Password sans taper sur prod).
//   * antimagne T-317 préservée : les valeurs sont figées au build, AUCUNE
//     donnée externe runtime (Host header, query string) n'entre dans la
//     construction des URLs envoyées par mail.
//   * fail-fast : lib/env/urls.ts throw au module-load si une var manque,
//     donc un oubli de config Vercel casse le build (pas un mail envoyé sur
//     localhost en silence — leçon ef7f10b).

import {
  NEXT_PUBLIC_ADMIN_URL,
  NEXT_PUBLIC_APP_URL,
} from "@/lib/env/urls";

export const AUTH_CALLBACK_ADMIN = `${NEXT_PUBLIC_ADMIN_URL}/auth/callback`;
export const AUTH_CALLBACK_DEFAULT = `${NEXT_PUBLIC_APP_URL}/auth/callback`;

export function getAuthCallbackUrl(isAdmin: boolean): string {
  return isAdmin ? AUTH_CALLBACK_ADMIN : AUTH_CALLBACK_DEFAULT;
}

// Étape 2 du flow recovery (page form nouveau mdp). Le template Supabase
// "Reset Password" honore {{ .RedirectTo }} et y ajoute ?token_hash=...
// &type=recovery, donc l'URL ci-dessous N'inclut PAS de query string
// (cohérent avec le contrat magic link). Subdomain-aware pour préserver
// l'isolation cookies admin (Chantier 4) : un admin qui demande reset
// depuis admin.* revient sur admin.* sans détour par www.*.
export const PASSWORD_RESET_ADMIN = `${NEXT_PUBLIC_ADMIN_URL}/reinitialiser-mot-de-passe`;
export const PASSWORD_RESET_DEFAULT = `${NEXT_PUBLIC_APP_URL}/reinitialiser-mot-de-passe`;

export function getPasswordResetUrl(isAdmin: boolean): string {
  return isAdmin ? PASSWORD_RESET_ADMIN : PASSWORD_RESET_DEFAULT;
}
