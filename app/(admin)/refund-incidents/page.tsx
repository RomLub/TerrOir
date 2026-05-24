import { Suspense } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseCursor, type ParsedCursor } from "@/lib/pagination/cursor";
import { fetchAdminRefundIncidentsList } from "@/lib/admin/refund-incidents/fetch";
import {
  REFUND_INCIDENT_STATUS_FILTERS,
  type RefundIncidentStatusFilter,
} from "@/lib/admin/refund-incidents/types";
import { RefundsTabNav } from "../_components/RefundsTabNav";
import { SectionSkeleton } from "../_components/ContentSkeletons";
import { RefundIncidentsListClient } from "./_components/RefundIncidentsListClient";

// Page admin /refund-incidents (PR3 feature/admin-new-surfaces — gap
// AUDIT_ADMIN.md §6 P0 #3). Surface admin de consultation + résolution
// manuelle des incidents refund Stripe bloqués (retries épuisés ou
// intervention humaine requise avant épuisement).
//
// Pattern READ admin (cf. PR1 /gestion-producteurs/page.tsx) : Server
// Component force-dynamic + service_role + helper fetch centralisé +
// pagination cursor (created_at DESC + id DESC tie-breaker).
//
// Auth déjà gardée par app/(admin)/layout.tsx (redirect /connexion si
// !isAdmin + check host admin.* prod-only).
export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function parseStatusFilter(
  raw: string | string[] | undefined,
): RefundIncidentStatusFilter {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (
    value &&
    (REFUND_INCIDENT_STATUS_FILTERS as ReadonlyArray<string>).includes(value)
  ) {
    return value as RefundIncidentStatusFilter;
  }
  // Default : "pending" (les incidents qui demandent attention admin).
  return "pending";
}

export default async function AdminRefundIncidentsPage(props: Props) {
  const searchParams = await props.searchParams;
  const cursor = parseCursor({
    get: (k: string) => {
      const v = searchParams[k];
      return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
    },
  });
  const statusFilter = parseStatusFilter(searchParams.status);

  // Coquille synchrone : le RefundsTabNav reste fixe, la liste est streamée.
  return (
    <>
      <RefundsTabNav active="incidents" />
      <Suspense fallback={<SectionSkeleton rows={6} />}>
        <RefundIncidentsContent cursor={cursor} statusFilter={statusFilter} />
      </Suspense>
    </>
  );
}

// Exporté pour les tests unitaires : c'est ici que vit la logique data (fetch
// service_role + propagation au client). La page reste une coquille avec le
// RefundsTabNav synchrone + ce contenu streamé en <Suspense>.
export async function RefundIncidentsContent({
  cursor,
  statusFilter,
}: {
  cursor: ParsedCursor;
  statusFilter: RefundIncidentStatusFilter;
}) {
  const admin = createSupabaseAdminClient();
  const result = await fetchAdminRefundIncidentsList(admin, {
    cursor,
    statusFilter,
  });

  return (
    <RefundIncidentsListClient
      initialRows={result.rows}
      initialTotal={result.total}
      initialNextCursor={result.nextCursor}
      initialError={result.error}
      initialStatusFilter={statusFilter}
      isPaginated={Boolean(cursor.before && cursor.beforeId)}
    />
  );
}
