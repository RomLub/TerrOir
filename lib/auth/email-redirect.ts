// Callbacks dédiés aux flows Supabase Auth qui envoient un email avec
// emailRedirectTo (magic link, change email). Le rôle dicte le host :
//   admin → admin.terroir-local.fr (cookies isolés)
//   autres (consumer + producer) → www.terroir-local.fr (cookies partagés
//     .terroir-local.fr couvrent pro)
//
// Source unique vs duplication entre flows. Aligné sur magic link
// (cf. requestMagicLinkAction) et change email (cf. changeEmailAction).

export const AUTH_CALLBACK_ADMIN =
  "https://admin.terroir-local.fr/auth/callback";
export const AUTH_CALLBACK_DEFAULT =
  "https://www.terroir-local.fr/auth/callback";

export function getAuthCallbackUrl(isAdmin: boolean): string {
  return isAdmin ? AUTH_CALLBACK_ADMIN : AUTH_CALLBACK_DEFAULT;
}
