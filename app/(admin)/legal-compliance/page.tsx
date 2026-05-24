import { Suspense } from "react";
import { AdminPageHeader, MetricCard } from "@/components/ui";
import {
  getCGUComplianceStats,
  listUsersWithCGUStatus,
  DEFAULT_PAGE_SIZE,
} from "@/lib/legal/compliance";
import { LEGAL_VERSIONS } from "@/lib/legal/versions";
import { parseSearchParams } from "./_lib/parse-search-params";
import { ComplianceFilters } from "./_components/Filters";
import { ComplianceUsersTable } from "./_components/UsersTable";
import { CompliancePagination } from "./_components/Pagination";
import { SectionSkeleton } from "../_components/ContentSkeletons";

// Page admin /admin/legal-compliance — vue de pilotage opposabilité CGU.
//
// Server Component dynamique : data fetching à chaque requête (pas de cache
// — l'admin doit voir l'état temps réel). (admin)/layout.tsx fait déjà le
// check session + isAdmin + host. Lecture via service_role (helpers
// lib/legal/compliance.ts) car la RLS users.self-read empêche l'admin de
// voir tous les users.
//
// Default filter = "never_accepted" : focus pré-launch sur les 11 users
// existants pré-2026-05-06 sans cgu_accepted_at peuplé. Cf. parse-search-params.


type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function pct(part: number, total: number): string {
  if (total === 0) return "—";
  return `${Math.round((part / total) * 100)} %`;
}

// Coquille SYNCHRONE (streaming Suspense) : aucun accès dynamique en tête.
// L'en-tête (statique) s'affiche immédiatement (le shell admin reste fixe), le
// searchParams (donnée de requête) est lu DANS le Gate. Les stats CGU + la liste
// (lecture service_role) sont streamées via <Suspense>.
export default function LegalCompliancePage(props: Props) {
  return (
    <div>
      <AdminPageHeader
        eyebrow="Conformité"
        title="Conformité CGU"
        subtitle={`Suivi de l'acceptation des CGU (version courante v${LEGAL_VERSIONS.CGU})`}
      />

      <Suspense fallback={<SectionSkeleton rows={8} />}>
        <ComplianceGate searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

// Gate DANS le <Suspense> : await + parse du searchParams, puis délègue au
// contenu data.
async function ComplianceGate({
  searchParams,
}: {
  searchParams: Props["searchParams"];
}) {
  const sp = await searchParams;
  const filters = parseSearchParams(sp);
  return <ComplianceContent filters={filters} />;
}

async function ComplianceContent({
  filters,
}: {
  filters: ReturnType<typeof parseSearchParams>;
}) {
  const limit = DEFAULT_PAGE_SIZE;
  const offset = (filters.page - 1) * limit;

  let errorMsg: string | null = null;
  let stats = {
    total: 0,
    acceptedCurrent: 0,
    acceptedOutdated: 0,
    neverAccepted: 0,
  };
  let users = {
    users: [] as Awaited<
      ReturnType<typeof listUsersWithCGUStatus>
    >["users"],
    total: 0,
    page: 1,
    totalPages: 1,
  };

  try {
    const [statsRes, usersRes] = await Promise.all([
      getCGUComplianceStats(),
      listUsersWithCGUStatus({
        status: filters.status,
        search: filters.search,
        limit,
        offset,
      }),
    ]);
    stats = statsRes;
    users = usersRes;
  } catch (err) {
    errorMsg = (err as Error).message ?? "Erreur de chargement";
  }

  return (
    <>
      {errorMsg ? (
        <p className="mb-4 text-[13px] text-red-600" role="alert">
          {errorMsg}
        </p>
      ) : null}

      <section className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Total utilisateurs"
          value={stats.total}
          hint="Tous comptes actifs"
        />
        <MetricCard
          label={`CGU à jour (v${LEGAL_VERSIONS.CGU})`}
          value={stats.acceptedCurrent}
          hint={pct(stats.acceptedCurrent, stats.total)}
        />
        <MetricCard
          label="CGU obsolète"
          value={stats.acceptedOutdated}
          hint={pct(stats.acceptedOutdated, stats.total)}
        />
        <MetricCard
          label="Jamais acceptée"
          value={stats.neverAccepted}
          hint={pct(stats.neverAccepted, stats.total)}
        />
      </section>

      <ComplianceFilters status={filters.status} search={filters.search} />

      <ComplianceUsersTable rows={users.users} />

      <CompliancePagination
        status={filters.status}
        search={filters.search}
        page={users.page}
        totalPages={users.totalPages}
        total={users.total}
      />
    </>
  );
}
