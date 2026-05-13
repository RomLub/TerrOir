import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { AdminDashboardData } from "./types";

// PR2 admin dashboard — wrapper d'appel à la RPC `get_admin_dashboard()`.
// Server-only : la RPC est SECURITY DEFINER + service_role uniquement
// (cf. migration 20260513124041). Utiliser createSupabaseAdminClient,
// jamais le client browser ou server-RLS.
//
// Fail-safe : si la RPC échoue (DB down, syntax error, etc.), on log côté
// serveur et on retourne null. La page consommatrice doit afficher un
// état d'erreur lisible (pas un crash 500).

export async function fetchAdminDashboard(): Promise<AdminDashboardData | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("get_admin_dashboard");

  if (error) {
    console.error(
      `[ADMIN_DASHBOARD_RPC_ERR] message=${error.message} code=${error.code ?? "unknown"}`,
    );
    return null;
  }

  // La RPC retourne un JSONB unique. Supabase JS désérialise en objet JS.
  // Pas de validation Zod : le contrat est garanti par la migration SQL
  // (jsonb_build_object). On accepte le cast direct.
  return (data as unknown) as AdminDashboardData;
}
