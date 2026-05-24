import { Suspense } from "react";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fetchAdminAccounts } from "@/lib/admin/admins/fetch";
import { ListSkeleton } from "../_components/ContentSkeletons";
import { AdminsClient } from "./_components/AdminsClient";

// Chantier 6 — page « Administrateurs » (section Gouvernance). Gestion du
// cycle de vie des comptes admins. Lecture pour tout admin ; actions
// réservées au super_admin (gate côté UI + route + RPC, défense en
// profondeur). Remplace l'entrée transitoire « Utilisateurs » (chantier 5)
// et le /users LIST supprimé.
//
// Auth gardée par app/(admin)/layout.tsx (redirect /connexion si !isAdmin).
// Lot B perf : la liste des comptes (fetch service_role) est streamée via
// <Suspense> pour que le shell admin reste fixe.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminsPage() {
  const session = await getSessionUser();

  return (
    <Suspense fallback={<ListSkeleton rows={6} />}>
      <AdminsContent
        currentAdminId={session?.id ?? ""}
        isSuperAdmin={session?.isSuperAdmin ?? false}
      />
    </Suspense>
  );
}

async function AdminsContent({
  currentAdminId,
  isSuperAdmin,
}: {
  currentAdminId: string;
  isSuperAdmin: boolean;
}) {
  const admin = createSupabaseAdminClient();
  const { rows, error } = await fetchAdminAccounts(admin);

  return (
    <AdminsClient
      admins={rows}
      initialError={error}
      currentAdminId={currentAdminId}
      isSuperAdmin={isSuperAdmin}
    />
  );
}
