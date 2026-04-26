import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { UserRole } from "./roles";
import type { InitialUserPayload } from "./types";

export type { InitialUserPayload };

export interface SessionUser {
  id: string;
  email: string | null;
  roles: UserRole[];
  isAdmin: boolean;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // Lookup parallèle : un même auth.users.id ne peut pas être simultanément
  // dans public.users et public.admin_users (cf. trigger d'exclusion mutuelle),
  // donc au plus une des deux requêtes renvoie une ligne.
  const [userRes, adminRes] = await Promise.all([
    supabase.from("users").select("roles").eq("id", user.id).maybeSingle(),
    supabase.from("admin_users").select("id").eq("id", user.id).maybeSingle(),
  ]);

  const roles = (userRes.data?.roles as UserRole[] | undefined) ?? [];
  const isAdmin = !!adminRes.data;

  return {
    id: user.id,
    email: user.email ?? null,
    roles,
    isAdmin,
  };
}

// Helper serveur pour vérifier l'admin par userId sans session complète.
// Utilise le client admin (service_role) pour contourner la RLS.
export async function isAdmin(userId: string): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("admin_users")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  return !!data;
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
// Note archi : isAdmin && isProducer === true est impossible côté DB
// (triggers users_exclusive_with_admin / admin_users_exclusive_with_users,
// migration 20260421100000) — mais on garde les 2 lookups indépendants par
// robustesse défensive contre un état corrompu hypothétique.
export async function getInitialUserPayload(): Promise<InitialUserPayload> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { user: null, isAdmin: false, isProducer: false };

  const [isAdmin, isProducer] = await Promise.all([
    (async () => {
      try {
        const { data, error } = await supabase
          .from("admin_users")
          .select("id")
          .eq("id", user.id)
          .maybeSingle();
        if (error) throw error;
        return !!data;
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
          .select("id")
          .eq("user_id", user.id)
          .maybeSingle();
        if (error) throw error;
        return !!data;
      } catch (err) {
        console.error(
          "[GET_INITIAL_USER_PAYLOAD_WARN] producer lookup failed",
          err,
        );
        return false;
      }
    })(),
  ]);

  return { user, isAdmin, isProducer };
}
