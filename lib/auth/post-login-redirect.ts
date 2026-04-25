import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Source unique de la logique de routing post-login. Utilisé par :
//   - loginAction (form password sur /connexion) : redirect local
//   - /auth/callback (magic link, signup, invite) : redirect canonique
//     cross-domain
//   - layout /connexion (DETTE B, session déjà active) : redirect local

const ADMIN_HOST = "admin.terroir-local.fr";
const PRODUCER_HOST = "pro.terroir-local.fr";
const WWW_HOST = "www.terroir-local.fr";

export type RoleSnapshot = {
  isAdmin: boolean;
  isProducer: boolean;
  producerStatut: string | null;
};

// Lecture parallèle admin_users + users.roles. La table producers n'est
// interrogée que si le rôle 'producer' est présent (évite une requête
// inutile sur la majorité des sessions).
export async function loadRoleSnapshot(
  supabase: SupabaseClient,
  userId: string,
): Promise<RoleSnapshot> {
  const [adminRes, profileRes] = await Promise.all([
    supabase
      .from("admin_users")
      .select("id")
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("users")
      .select("roles")
      .eq("id", userId)
      .maybeSingle(),
  ]);

  const isAdmin = !!adminRes.data;
  const roles = (profileRes.data?.roles as string[] | undefined) ?? [];
  const isProducer = roles.includes("producer");

  let producerStatut: string | null = null;
  if (isProducer) {
    const { data: producerRow } = await supabase
      .from("producers")
      .select("statut")
      .eq("user_id", userId)
      .maybeSingle();
    producerStatut = (producerRow?.statut as string | undefined) ?? null;
  }

  return { isAdmin, isProducer, producerStatut };
}

// Cible canonique post-login : sur quel host+path l'user devrait atterrir
// quel que soit son point d'entrée. Utilisé par /auth/callback (magic link)
// pour router cross-domain vers le bon sous-domaine.
//   admin                          → admin.*/tableau-de-bord
//   producer (statut public/etc)   → pro.*/dashboard
//   producer (statut draft)        → pro.*/onboarding
//   producer (deleted/null) ou consumer → www.*/compte
export function canonicalPostLoginTarget(role: RoleSnapshot): {
  host: string;
  path: string;
} {
  if (role.isAdmin) return { host: ADMIN_HOST, path: "/tableau-de-bord" };
  if (
    role.isProducer &&
    role.producerStatut &&
    role.producerStatut !== "deleted"
  ) {
    return {
      host: PRODUCER_HOST,
      path: role.producerStatut === "draft" ? "/onboarding" : "/dashboard",
    };
  }
  return { host: WWW_HOST, path: "/compte" };
}

export function canonicalPostLoginUrl(role: RoleSnapshot): string {
  const { host, path } = canonicalPostLoginTarget(role);
  return `https://${host}${path}`;
}

// Path post-login local : ne traverse pas de sous-domaine. Utilisé par
// loginAction (form password) et le check session de /connexion.
//   admin → /tableau-de-bord (toujours)
//   producer SUR pro.* (statut public/draft) → /dashboard | /onboarding
//   reste (consumer, producer ailleurs, statut deleted) → /compte
//
// Note pro.*: un producer qui se connecte sur www.*/connexion atterrit sur
// /compte (pré-existant ; il bascule ensuite vers pro.* via le switcher de
// la nav). Le routing cross-domain est réservé au callback magic link.
export function localPostLoginPath(
  role: RoleSnapshot,
  host: string,
): string {
  if (role.isAdmin) return "/tableau-de-bord";
  if (
    host === PRODUCER_HOST &&
    role.isProducer &&
    role.producerStatut &&
    role.producerStatut !== "deleted"
  ) {
    return role.producerStatut === "draft" ? "/onboarding" : "/dashboard";
  }
  return "/compte";
}

// Garde anti open-redirect : on n'accepte qu'un path local same-origin.
//   - doit commencer par "/"
//   - ne doit PAS commencer par "//" (URL protocol-relative → host arbitraire)
//   - ne doit PAS commencer par "/\\" (certains browsers normalisent en "//")
// Pas de cross-domain via redirectTo : si l'user est sur pro.*/connexion,
// il reste sur pro.* — le routing cross-subdomain reste l'apanage du
// callback magic link via canonicalPostLoginUrl.
export function isValidRedirectPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//") || value.startsWith("/\\")) return false;
  return true;
}

// Résolution post-login : si l'user avait une intention de navigation
// préservée par le middleware (?redirectTo=/panier), on la respecte.
// Sinon fallback sur la cible canonique du rôle.
//
// Note rôle vs path : on ne vérifie pas que redirectTo est compatible avec
// le rôle (ex: consumer demandant /tableau-de-bord). Le middleware rejettera
// après auth, ce qui peut renvoyer sur /connexion → potentielle boucle si
// le middleware a un bug. Acceptable : duplique pas la logique d'autorisation
// ici, le middleware est la source de vérité.
export function resolvePostLoginPath(
  role: RoleSnapshot,
  host: string,
  requestedRedirect: unknown,
): string {
  if (isValidRedirectPath(requestedRedirect)) return requestedRedirect;
  return localPostLoginPath(role, host);
}
