import "server-only";
import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { UserRole } from "./roles";

export interface SessionUser {
  id: string;
  email: string | null;
  roles: UserRole[];
  isAdmin: boolean;
}

// Payload SSR consommé par UserProvider pour démarrer avec le bon état admin
// dès le premier render et éviter le flash badge Admin au hard refresh.
// Étend le pattern initialUser SSR (commit 6a9ebd3).
export interface InitialUserPayload {
  user: User | null;
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

// Pré-fetch SSR pour UserProvider : auth.getUser() + lookup admin_users
// via RLS self-read (policy "admin_users self read" autorise authenticated
// where id = auth.uid()). Pas de service_role nécessaire.
//
// Fail-safe : si le lookup admin throw, on retombe sur isAdmin=false plutôt
// que de bloquer le rendu du layout root. Le client corrigera via
// onAuthStateChange → loadProfile au mount.
export async function getInitialUserPayload(): Promise<InitialUserPayload> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { user: null, isAdmin: false };

  try {
    const { data, error } = await supabase
      .from("admin_users")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();
    if (error) throw error;
    return { user, isAdmin: !!data };
  } catch (err) {
    console.error("[GET_INITIAL_USER_PAYLOAD_WARN] admin lookup failed", err);
    return { user, isAdmin: false };
  }
}
