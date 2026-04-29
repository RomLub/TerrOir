// Callbacks dédiés aux flows Supabase Auth qui envoient un email avec
// emailRedirectTo (magic link, change email, password reset). Le rôle dicte
// le host :
//   admin → admin.terroir-local.fr (cookies isolés)
//   autres (consumer + producer) → www.terroir-local.fr (cookies partagés
//     .terroir-local.fr couvrent pro)
//
// Source unique vs duplication entre flows. Aligné sur magic link
// (cf. requestMagicLinkAction), change email (cf. changeEmailAction) et
// password reset (cf. requestPasswordResetAction).
//
// URLs hardcodées (non-preview-aware) : protection prioritaire contre les
// attaques de type host header injection (T-317) — on n'accepte AUCUNE
// donnée externe pour construire les URLs envoyées par mail. Le bug latent
// "preview vs prod" sera traité globalement dans un chantier dédié couvrant
// tous les helpers email d'un coup.

export const AUTH_CALLBACK_ADMIN =
  "https://admin.terroir-local.fr/auth/callback";
export const AUTH_CALLBACK_DEFAULT =
  "https://www.terroir-local.fr/auth/callback";

export function getAuthCallbackUrl(isAdmin: boolean): string {
  return isAdmin ? AUTH_CALLBACK_ADMIN : AUTH_CALLBACK_DEFAULT;
}

// Étape 2 du flow recovery (page form nouveau mdp). Le template Supabase
// "Reset Password" honore {{ .RedirectTo }} et y ajoute ?token_hash=...
// &type=recovery, donc l'URL ci-dessous N'inclut PAS de query string
// (cohérent avec le contrat magic link). Subdomain-aware pour préserver
// l'isolation cookies admin (Chantier 4) : un admin qui demande reset
// depuis admin.* revient sur admin.* sans détour par www.*.
export const PASSWORD_RESET_ADMIN =
  "https://admin.terroir-local.fr/reinitialiser-mot-de-passe";
export const PASSWORD_RESET_DEFAULT =
  "https://www.terroir-local.fr/reinitialiser-mot-de-passe";

export function getPasswordResetUrl(isAdmin: boolean): string {
  return isAdmin ? PASSWORD_RESET_ADMIN : PASSWORD_RESET_DEFAULT;
}
