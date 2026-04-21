import type { CookieOptionsWithName } from "@supabase/ssr";

// Partage de la session Supabase entre les sous-domaines de production
// (www / pro / admin). La syntaxe `.terroir-local.fr` avec point initial
// est requise par la RFC 6265 pour autoriser tous les sous-domaines à
// lire et écrire le cookie.
//
// En dev (localhost / pro.localhost), on laisse le domaine à undefined :
// le navigateur pose alors le cookie sur l'host courant, comportement
// par défaut suffisant puisqu'on ne teste pas le cross-subdomain en dev.
const SHARED_COOKIE_DOMAIN = ".terroir-local.fr";

export const sharedCookieOptions: CookieOptionsWithName =
  process.env.NODE_ENV === "production"
    ? { domain: SHARED_COOKIE_DOMAIN }
    : {};
