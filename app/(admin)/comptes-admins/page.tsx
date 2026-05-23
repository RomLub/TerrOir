import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fetchAdminAccounts } from "@/lib/admin/admins/fetch";
import { AdminsClient } from "./_components/AdminsClient";

// Chantier 6 — page « Administrateurs » (section Gouvernance). Gestion du
// cycle de vie des comptes admins. Lecture pour tout admin ; actions
// réservées au super_admin (gate côté UI + route + RPC, défense en
// profondeur). Remplace l'entrée transitoire « Utilisateurs » (chantier 5)
// et le /users LIST supprimé.
//
// Auth gardée par app/(admin)/layout.tsx (redirect /connexion si !isAdmin).
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminsPage() {
  const session = await getSessionUser();
  const admin = createSupabaseAdminClient();
  const { rows, error } = await fetchAdminAccounts(admin);

  return (
    <AdminsClient
      admins={rows}
      initialError={error}
      currentAdminId={session?.id ?? ""}
      isSuperAdmin={session?.isSuperAdmin ?? false}
    />
  );
}
