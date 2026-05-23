import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fetchAdminPendingRefundsList } from "@/lib/admin/refunds/fetch";
import { RefundsTabNav } from "../../_components/RefundsTabNav";
import { PendingRefundsClient } from "./_components/PendingRefundsClient";

// Chantier 5 — onglet « Demandes à arbitrer » de la section Remboursements
// (fusion avec /refund-incidents via RefundsTabNav). Server component qui
// fetch les rows (helper lib/admin/refunds/fetch) + render le client avec
// server actions wired.
//
// Auth déjà gardée par app/(admin)/layout.tsx (redirect si !isAdmin).

export const dynamic = "force-dynamic";

export default async function AdminPendingRefundsPage() {
  const admin = createSupabaseAdminClient();
  const { rows, error } = await fetchAdminPendingRefundsList(admin);

  if (error) {
    console.error(`[ADMIN_PENDING_REFUNDS_FETCH_ERR] ${error}`);
    return (
      <>
        <RefundsTabNav active="demandes" />
        <div className="p-6">
          <p className="text-red-700">Erreur de chargement. Voir logs Vercel.</p>
        </div>
      </>
    );
  }

  return (
    <>
      <RefundsTabNav active="demandes" />
      <PendingRefundsClient rows={rows} />
    </>
  );
}
