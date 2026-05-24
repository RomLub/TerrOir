import { Suspense } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fetchAdminPendingRefundsList } from "@/lib/admin/refunds/fetch";
import { RefundsTabNav } from "../../_components/RefundsTabNav";
import { SectionSkeleton } from "../../_components/ContentSkeletons";
import { PendingRefundsClient } from "./_components/PendingRefundsClient";

// Chantier 5 — onglet « Demandes à arbitrer » de la section Remboursements
// (fusion avec /refund-incidents via RefundsTabNav). Server component qui
// fetch les rows (helper lib/admin/refunds/fetch) + render le client avec
// server actions wired.
//
// Auth déjà gardée par app/(admin)/layout.tsx (redirect si !isAdmin).
// Lot B perf : le RefundsTabNav reste fixe (sync), la liste est streamée.

export const dynamic = "force-dynamic";

export default async function AdminPendingRefundsPage() {
  return (
    <>
      <RefundsTabNav active="demandes" />
      <Suspense fallback={<SectionSkeleton rows={5} />}>
        <PendingRefundsContent />
      </Suspense>
    </>
  );
}

async function PendingRefundsContent() {
  const admin = createSupabaseAdminClient();
  const { rows, error } = await fetchAdminPendingRefundsList(admin);

  if (error) {
    console.error(`[ADMIN_PENDING_REFUNDS_FETCH_ERR] ${error}`);
    return (
      <div className="p-6">
        <p className="text-red-700">Erreur de chargement. Voir logs Vercel.</p>
      </div>
    );
  }

  return <PendingRefundsClient rows={rows} />;
}
