import { Suspense } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  buildCursorUrl,
  parseCursor,
  type ParsedCursor,
} from "@/lib/pagination/cursor";
import { AdminPageHeader, TableStatus } from "@/components/ui";
import { ListingHeader } from "@/components/listings/ListingHeader";
import { formatDateFr } from "@/lib/format/date";
import { fetchAdminInvitationsList } from "@/lib/admin/invitations/fetch";
import {
  INVITATION_STATUS_LABELS,
  type InvitationStatus,
  type InvitationStatusFilter,
} from "@/lib/admin/invitations/types";
import { InvitationsListClient } from "./_components/InvitationsListClient";
import { RevokeInvitationTrigger } from "./_components/RevokeInvitationTrigger";
import { SectionSkeleton } from "../_components/ContentSkeletons";
import Link from "next/link";

// Server Component admin /invitations (chantier PR3
// feature/admin-new-surfaces, suite audit AUDIT_ADMIN § 6 P1 #6 — pas de
// listing admin des invitations sortantes). Pattern aligné PR1
// /gestion-producteurs : SSR via service_role + sub-clients pour les
// interactions (filtres tabs + modal de revoke avec POST
// /api/admin/invitations/[id]/revoke).
//
// La table producer_invitations n'a pas de colonne `status` ; les états
// sont computed côté query par `fetchAdminInvitationsList` (cf. helper).
export const dynamic = "force-dynamic";
export const revalidate = 0;

type SearchParams = {
  before?: string;
  before_id?: string;
  status?: string;
  from?: string;
  to?: string;
};

const ALL_STATUSES: InvitationStatusFilter[] = [
  "all",
  "sent",
  "consumed",
  "expired",
  "revoked",
];

function parseStatus(raw: string | undefined): InvitationStatusFilter {
  if (!raw) return "all";
  return (ALL_STATUSES as string[]).includes(raw)
    ? (raw as InvitationStatusFilter)
    : "all";
}

const STATUS_BADGE_CLASS: Record<InvitationStatus, string> = {
  // Vert : invitation en cours, lien actif.
  sent: "bg-emerald-100 text-emerald-900 border-emerald-300",
  // Bleu : invitation acceptée par le producer (lien utilisé).
  consumed: "bg-blue-100 text-blue-900 border-blue-300",
  // Gris : expirée naturellement (TTL dépassé sans clic).
  expired: "bg-gray-100 text-gray-700 border-gray-300",
  // Rouge : révoquée explicitement par admin.
  revoked: "bg-red-100 text-red-900 border-red-300",
};

export default async function AdminInvitationsPage(props: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await props.searchParams;

  const status = parseStatus(sp.status);
  const from = sp.from && sp.from.length > 0 ? sp.from : null;
  const to = sp.to && sp.to.length > 0 ? sp.to : null;

  const cursor = parseCursor({
    get(name: string) {
      return (sp as Record<string, string | undefined>)[name] ?? null;
    },
  });

  // Coquille synchrone : l'en-tête + les filtres (qui ne dépendent que des
  // searchParams) s'affichent immédiatement, la liste (fetch service_role) est
  // streamée via <Suspense>.
  return (
    <div>
      <AdminPageHeader
        eyebrow="Invitations"
        title="Invitations producteurs"
        subtitle="Liste des invitations sortantes, statuts computed et action de révocation"
      />

      <InvitationsListClient
        currentStatus={status}
        currentFrom={from ?? ""}
        currentTo={to ?? ""}
      />

      <Suspense fallback={<SectionSkeleton rows={8} />}>
        <InvitationsContent
          cursor={cursor}
          status={status}
          from={from}
          to={to}
        />
      </Suspense>
    </div>
  );
}

// Exporté pour les tests unitaires : c'est ici que vit la logique data (fetch
// service_role + propagation erreur/listing). La page reste une coquille avec
// l'en-tête + les filtres synchrones et ce contenu streamé en <Suspense>.
export async function InvitationsContent({
  cursor,
  status,
  from,
  to,
}: {
  cursor: ParsedCursor;
  status: InvitationStatusFilter;
  from: string | null;
  to: string | null;
}) {
  const admin = createSupabaseAdminClient();
  const { rows, total, nextCursor, error } = await fetchAdminInvitationsList(
    admin,
    {
      cursor,
      status,
      from: from ? new Date(from).toISOString() : null,
      // Borne 'to' : on étend à 23:59:59 pour rendre la borne inclusive
      // par convention UX (filtre date "jusqu'au 12/05/2026" inclut tout
      // ce jour).
      to: to ? new Date(`${to}T23:59:59.999Z`).toISOString() : null,
    },
  );

  const isPaginated = cursor.before !== null;

  // Cursor URL preserve les filtres status/from/to en plus de la pagination.
  const cursorBase = (() => {
    const params = new URLSearchParams();
    if (status !== "all") params.set("status", status);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const qs = params.toString();
    return qs ? `/invitations?${qs}` : "/invitations";
  })();

  return (
    <>
      {error ? (
        <p className="mb-4 text-[13px] text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mb-4">
        <ListingHeader
          displayed={rows.length}
          total={total}
          label="invitations"
          isPaginated={isPaginated}
        />
      </div>

      <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-100 text-left text-[11px] uppercase tracking-[0.14em] text-gray-600">
                <th className="px-5 py-3 font-semibold">Email</th>
                <th className="px-5 py-3 font-semibold">Statut</th>
                <th className="px-5 py-3 font-semibold">Envoyée le</th>
                <th className="px-5 py-3 font-semibold">Expire le</th>
                <th className="px-5 py-3 font-semibold">Consommée le</th>
                <th className="px-5 py-3 font-semibold">Révoquée le</th>
                <th className="px-5 py-3 font-semibold">Créée par</th>
                <th className="px-5 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <TableStatus
                  kind="empty"
                  colSpan={8}
                  emptyLabel="Aucune invitation pour ce filtre."
                />
              ) : (
                rows.map((inv) => (
                  <tr
                    key={inv.id}
                    className="border-b border-gray-200 last:border-0 hover:bg-gray-50"
                  >
                    <td className="px-5 py-4 text-gray-900">{inv.email}</td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${STATUS_BADGE_CLASS[inv.status]}`}
                      >
                        {INVITATION_STATUS_LABELS[inv.status]}
                      </span>
                    </td>
                    <td className="px-5 py-4 font-mono text-[13px] text-gray-700">
                      {formatDateFr(inv.createdAt)}
                    </td>
                    <td className="px-5 py-4 font-mono text-[13px] text-gray-700">
                      {formatDateFr(inv.expiresAt)}
                    </td>
                    <td className="px-5 py-4 font-mono text-[13px] text-gray-700">
                      {inv.usedAt ? formatDateFr(inv.usedAt) : "—"}
                    </td>
                    <td className="px-5 py-4 font-mono text-[13px] text-gray-700">
                      {inv.revokedAt ? formatDateFr(inv.revokedAt) : "—"}
                    </td>
                    <td className="px-5 py-4 text-gray-700">
                      {inv.createdByEmail ?? "—"}
                    </td>
                    <td className="px-5 py-4 text-right">
                      {inv.status === "sent" ? (
                        <RevokeInvitationTrigger
                          invitationId={inv.id}
                          invitationEmail={inv.email}
                        />
                      ) : (
                        <span className="text-[12px] text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {nextCursor && (
        <div className="mt-6 flex justify-center">
          <Link
            href={buildCursorUrl(cursorBase, nextCursor)}
            className="text-[14px] font-medium text-terroir-green-700 underline hover:text-terroir-green-700/80"
          >
            Charger les 50 plus anciennes
          </Link>
        </div>
      )}
    </>
  );
}
