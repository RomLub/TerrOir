import "server-only";
import { cookies, headers } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";
import { isValidRedirectPath } from "./post-login-redirect";

// Cookie de "deep-link post-auth" pour le flow magic link OTP token_hash.
// Posé côté Server Action requestMagicLinkAction, lu côté Route Handler
// /auth/callback après verifyOtp/exchange. Compense le fait qu'on ne peut
// plus passer ?redirectTo= via emailRedirectTo : le template Supabase fait
// désormais `{{ .RedirectTo }}?token_hash=…&type=magiclink`, et un second `?`
// dans RedirectTo casse l'URL email.
//
// Cross-subdomain : domain `.terroir-local.fr` pour que le cookie posé sur
// www.* lors du form submit soit lisible sur admin.* (callback admin) et
// pro.* (callback producer). HttpOnly + Secure réduisent l'exposition.

const COOKIE_NAME = "redirect_after_auth";
const SHARED_DOMAIN = ".terroir-local.fr";
const APEX = "terroir-local.fr";
const MAX_AGE_SECONDS = 60 * 60; // 1h — suffisant pour cliquer sur un magic link.

interface RedirectCookieOptions {
  domain?: string;
  path: string;
  maxAge: number;
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
}

function cookieOptionsForHost(
  host: string | null | undefined,
): RedirectCookieOptions {
  const hostname = (host ?? "").split(":")[0]?.toLowerCase() ?? "";
  const isProd = hostname === APEX || hostname.endsWith(`.${APEX}`);
  return {
    // Domain partagé en prod uniquement. Sur localhost / staging avec un host
    // différent, on laisse le cookie scopé au host courant (pas de domain).
    ...(isProd ? { domain: SHARED_DOMAIN } : {}),
    path: "/",
    maxAge: MAX_AGE_SECONDS,
    httpOnly: true,
    // Secure obligatoire si SameSite=Lax cross-subdomain en prod ; en dev
    // localhost (HTTP), Secure rejette le cookie — on le retire pour ne pas
    // casser le dev local.
    secure: isProd,
    sameSite: "lax",
  };
}

// Pose le cookie depuis une Server Action. La validation isValidRedirectPath
// est appliquée ici (defense-in-depth) pour qu'un FormData injecté avec un
// path foireux ne contamine pas le cookie.
export function setRedirectAfterAuth(redirectTo: unknown): void {
  if (!isValidRedirectPath(redirectTo)) return;
  const host = headers().get("host");
  cookies().set(COOKIE_NAME, redirectTo, cookieOptionsForHost(host));
}

// Lit le cookie depuis une NextRequest (Route Handler /auth/callback).
// Re-valide isValidRedirectPath en defense-in-depth : même HttpOnly, on ne
// fait pas confiance aveuglément au contenu du cookie.
export function readRedirectAfterAuth(request: NextRequest): string | null {
  const raw = request.cookies.get(COOKIE_NAME)?.value;
  return isValidRedirectPath(raw) ? raw : null;
}

// Supprime le cookie en posant un cookie vide expiré sur la réponse. Utilise
// les MÊMES domain/path/secure/sameSite que le set : sinon le browser
// considère que c'est un cookie différent et ne le supprime pas.
export function clearRedirectAfterAuth(
  response: NextResponse,
  host: string | null | undefined,
): void {
  const opts = cookieOptionsForHost(host);
  response.cookies.set(COOKIE_NAME, "", {
    ...opts,
    maxAge: 0,
  });
}

// Exposé pour les tests unitaires (mocks).
export const __test__ = {
  COOKIE_NAME,
  cookieOptionsForHost,
};
