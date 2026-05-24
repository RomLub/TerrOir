import "server-only";
import type { User, JwtPayload } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { UserRole } from "./roles";
import type { InitialUserPayload, ProducerLite } from "./types";

export type { InitialUserPayload, ProducerLite };

// Perf (Lot A) : on vérifie la session via auth.getClaims() au lieu de
// auth.getUser(). Avec les clés de signature asymétriques (ES256) du projet,
// getClaims valide le JWT LOCALEMENT (Web Crypto), sans aller-retour réseau
// vers Supabase Auth à chaque requête — alors que getUser tape l'Auth server
// à chaque appel. La validation reste cryptographique (remplacement
// recommandé par Supabase en SSR), donc l'authz n'est pas affaiblie.
//
// getClaims renvoie un JwtPayload (claims décodés), pas un objet User complet.
// Les lookups DB en aval (users/admin_users/producers) ne consomment que
// `user.id`, et le payload SSR n'expose que id + email. On reconstruit donc un
// User minimal fidèle aux claims vérifiés (sub→id, email, aud, app/user
// metadata portés par le JWT), avec des valeurs sûres pour les champs requis
// du type User non présents dans le token. La forme de retour publique
// (SessionUser / InitialUserPayload) reste identique.
function userFromClaims(claims: JwtPayload): User {
  return {
    id: claims.sub,
    email: claims.email,
    phone: claims.phone,
    aud: Array.isArray(claims.aud) ? claims.aud[0] : claims.aud,
    role: claims.role,
    app_metadata: claims.app_metadata ?? {},
    user_metadata: claims.user_metadata ?? {},
    is_anonymous: claims.is_anonymous,
    // `created_at` est requis par le type User mais absent du JWT. On dérive de
    // `iat` (issued-at, epoch secondes) faute de mieux — non consommé en aval
    // (seuls id/email le sont), gardé pour la conformité de type.
    created_at: new Date(claims.iat * 1000).toISOString(),
  };
}

export interface SessionUser {
  id: string;
  email: string | null;
  roles: UserRole[];
  isAdmin: boolean;
  // Chantier 6 : un admin suspendu (suspended_at non null) n'est PAS isAdmin.
  // isSuperAdmin = admin actif avec privilège super_admin (gère les autres
  // admins). Toujours dérivé en live (jamais caché dans le snapshot).
  isSuperAdmin: boolean;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createSupabaseServerClient();
  const { data: claimsData, error: getClaimsError } =
    await supabase.auth.getClaims();

  // bugs-P2-1 (T9 2026-05-07) : fail-closed logging. Avant, une erreur de
  // vérification de session (Supabase Auth indispo, JWT corrompu, JWKS
  // injoignable) était silencieusement avalée car on ne destructurait que
  // `data.user`. La route appelante voyait alors un Unauthorized générique
  // sans signal côté SRE pour distinguer "session expirée" (normal) de
  // "Auth backend down" (incident). On loggue avec préfixe grep-able + on
  // continue le fail-closed (return null si pas de claims).
  if (getClaimsError) {
    console.error(
      `[AUTH_GETCLAIMS_ERR] supabase.auth.getClaims() failed: ${getClaimsError.message}`,
    );
  }

  if (!claimsData) return null;
  const user = userFromClaims(claimsData.claims);

  // Lookup parallèle : un même auth.users.id ne peut pas être simultanément
  // dans public.users et public.admin_users (cf. trigger d'exclusion mutuelle),
  // donc au plus une des deux requêtes renvoie une ligne.
  const [userRes, adminRes] = await Promise.all([
    supabase.from("users").select("roles").eq("id", user.id).maybeSingle(),
    supabase
      .from("admin_users")
      .select("id, admin_privilege, suspended_at")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  // bugs-P2-1 : log les erreurs de lookup (faux !isAdmin invisible côté SRE).
  // On continue avec roles=[] / isAdmin=false (fail-closed) — comportement
  // identique au précédent, mais visible côté logs maintenant.
  if (userRes.error) {
    console.error(
      `[AUTH_USERS_LOOKUP_ERR] user_id=${user.id} error=${userRes.error.message}`,
    );
  }
  if (adminRes.error) {
    console.error(
      `[AUTH_ADMIN_LOOKUP_ERR] user_id=${user.id} error=${adminRes.error.message}`,
    );
  }

  const roles = (userRes.data?.roles as UserRole[] | undefined) ?? [];
  // Chantier 6 : un admin suspendu (suspended_at non null) perd l'accès admin.
  const adminRow = adminRes.data as
    | { id: string; admin_privilege: string | null; suspended_at: string | null }
    | null;
  const isAdmin = !!adminRow && adminRow.suspended_at == null;
  const isSuperAdmin = isAdmin && adminRow!.admin_privilege === "super_admin";

  return {
    id: user.id,
    email: user.email ?? null,
    roles,
    isAdmin,
    isSuperAdmin,
  };
}

// Helper serveur pour vérifier l'admin par userId sans session complète.
// Utilise le client admin (service_role) pour contourner la RLS.
// Chantier 6 : un admin suspendu n'est plus admin.
export async function isAdmin(userId: string): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("admin_users")
    .select("id")
    .eq("id", userId)
    .is("suspended_at", null)
    .maybeSingle();
  return !!data;
}

// Chantier 6 : super_admin actif (gère les autres admins). Live DB read via
// service_role — jamais caché dans le snapshot (un changement de privilège
// prend effet immédiatement).
export async function isSuperAdmin(userId: string): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("admin_users")
    .select("admin_privilege, suspended_at")
    .eq("id", userId)
    .maybeSingle();
  return (
    !!data &&
    (data as { suspended_at: string | null }).suspended_at == null &&
    (data as { admin_privilege: string | null }).admin_privilege === "super_admin"
  );
}

// Pré-fetch SSR pour UserProvider : auth.getUser() + lookups admin_users +
// producers via RLS self-read. Cohérent avec :
//   - "admin_users self read"  (id = auth.uid())
//   - "producers owner read"   (auth.uid() = user_id)
// Pas de service_role nécessaire.
//
// Promise.all sur les 2 lookups (parallèle, ~5ms vs séquentiel).
// Fail-safe PAR lookup : si l'un throw, l'autre flag reste correct. Le client
// corrigera de toute façon via onAuthStateChange → loadProfile au mount.
//
// Le 2e lookup retourne directement un `ProducerLite | null` (id, slug,
// nom_exploitation, statut) — invariant `isProducer === (producerLite !== null)`,
// fusion en 1 round-trip vs 2 lookups distincts (cf. plan session 27/04).
// Le client ProducerLayout démarre avec un producer non-null dès le SSR →
// élimine le flash placeholder « — » au hard refresh.
//
// Note archi : isAdmin && isProducer === true est impossible côté DB
// (triggers users_exclusive_with_admin / admin_users_exclusive_with_users,
// migration 20260421100000) — mais on garde les 2 lookups indépendants par
// robustesse défensive contre un état corrompu hypothétique.
export async function getInitialUserPayload(): Promise<InitialUserPayload> {
  const supabase = await createSupabaseServerClient();
  // Perf (Lot A) : getClaims() valide le JWT localement (clés asymétriques),
  // sans round-trip réseau vers l'Auth server à chaque rendu SSR. Forme de
  // retour InitialUserPayload inchangée (user reconstruit depuis les claims).
  const { data: claimsData } = await supabase.auth.getClaims();

  if (!claimsData) {
    return {
      user: null,
      isAdmin: false,
      isProducer: false,
      producerLite: null,
      roles: [],
    };
  }

  const user = userFromClaims(claimsData.claims);

  const [isAdmin, producerLite, roles] = await Promise.all([
    (async () => {
      try {
        const { data, error } = await supabase
          .from("admin_users")
          .select("id, suspended_at")
          .eq("id", user.id)
          .maybeSingle();
        if (error) throw error;
        // Chantier 6 : admin suspendu (suspended_at non null) → pas admin.
        return (
          !!data && (data as { suspended_at: string | null }).suspended_at == null
        );
      } catch (err) {
        console.error(
          "[GET_INITIAL_USER_PAYLOAD_WARN] admin lookup failed",
          err,
        );
        return false;
      }
    })(),
    (async () => {
      try {
        const { data, error } = await supabase
          .from("producers")
          .select("id, slug, nom_exploitation, statut")
          .eq("user_id", user.id)
          .maybeSingle();
        if (error) throw error;
        return (data as ProducerLite | null) ?? null;
      } catch (err) {
        console.error(
          "[GET_INITIAL_USER_PAYLOAD_WARN] producerLite lookup failed",
          err,
        );
        return null;
      }
    })(),
    // T-012 : lookup `users.roles` parallèle aux 2 autres branches. Permet
    // au RoleToggle multi-rôle d'apparaître dès le SSR (sans attendre
    // loadProfile côté browser, qui introduisait un délai 50-200ms perçu
    // comme un "pop" du toggle au mount). RLS `users self read` autorise
    // la lecture via le client server normal (auth.uid() = id).
    // Fail-safe par lookup (pattern identique aux 2 autres) : un throw
    // ici n'affecte ni isAdmin ni producerLite ; loadProfile recorrigera
    // de toute façon au mount (filet de sécurité existant).
    (async (): Promise<UserRole[]> => {
      try {
        const { data, error } = await supabase
          .from("users")
          .select("roles")
          .eq("id", user.id)
          .maybeSingle();
        if (error) throw error;
        return (data?.roles as UserRole[] | undefined) ?? [];
      } catch (err) {
        console.error(
          "[GET_INITIAL_USER_PAYLOAD_WARN] roles lookup failed",
          err,
        );
        return [];
      }
    })(),
  ]);

  return {
    user,
    isAdmin,
    isProducer: producerLite !== null,
    producerLite,
    roles,
  };
}
