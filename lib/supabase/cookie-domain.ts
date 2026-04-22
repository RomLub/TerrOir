// Configuration des cookies Supabase en fonction du sous-domaine courant
// (Chantier 4 — isolation admin ↔ www/pro).
//
//   www.terroir-local.fr / pro.terroir-local.fr
//     → name par défaut (sb-<projectref>-auth-token)
//     → domain '.terroir-local.fr' : cookie partagé entre www et pro pour
//       qu'un consumer+producteur garde sa session en changeant de sous-
//       domaine.
//
//   admin.terroir-local.fr
//     → name 'sb-admin-auth-token' : nom distinct, indispensable pour que
//       le client Supabase côté admin IGNORE le cookie partagé posé par
//       www/pro (même apex, même nom par défaut → collision sinon).
//     → pas de domain : cookie lié à admin.* exclusivement, donc pas non
//       plus écrit sur '.terroir-local.fr'.
//
//   localhost, pro.localhost, admin.localhost, autres
//     → defaults Supabase (pas de domain, name par défaut sauf admin.*
//       qui garde le name distinct — utile pour tester l'isolation en dev).

const SHARED_DOMAIN = ".terroir-local.fr";
const APEX = "terroir-local.fr";
const ADMIN_COOKIE_NAME = "sb-admin-auth-token";

export function cookieConfigForHost(host: string | null | undefined): {
  name?: string;
  domain?: string;
} {
  if (!host) return {};
  const hostname = host.split(":")[0]?.toLowerCase() ?? "";
  if (hostname.startsWith("admin.")) {
    return { name: ADMIN_COOKIE_NAME };
  }
  if (hostname === APEX || hostname.endsWith(`.${APEX}`)) {
    return { domain: SHARED_DOMAIN };
  }
  return {};
}
