import { notFound } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  fetchAdminRefundIncidentAttempts,
  fetchAdminRefundIncidentDetail,
} from "@/lib/admin/refund-incidents/fetch";
import {
  getRefundIncidentKindLabel,
  getRefundIncidentStatusLabel,
  isRefundIncidentActionable,
} from "@/lib/admin/refund-incidents/types";
import { AdminPageHeader } from "@/components/ui";
import { formatDateFr } from "@/lib/format/date";
import { ResolveIncidentModalLauncher } from "./_components/ResolveIncidentModal";

// Page admin /refund-incidents/[id] (PR3 feature/admin-new-surfaces —
// gap AUDIT_ADMIN.md §6 P0 #3). Détail forensique d'un incident refund
// Stripe + section "Tentatives" + action "Résoudre manuellement"
// (conditionnée au statut actionnable).
//
// Server Component force-dynamic + service_role (cohérent pattern PR1).
// Auth gardée par app/(admin)/layout.tsx.
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
};

function formatAmount(cents: number): string {
  return `${(cents / 100).toFixed(2)} €`;
}

function formatDateTimeFr(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function AdminRefundIncidentDetailPage(props: Props) {
  const { id } = await props.params;
  const admin = createSupabaseAdminClient();

  const [{ incident, error: incidentError }, attemptsRes] = await Promise.all([
    fetchAdminRefundIncidentDetail(admin, id),
    fetchAdminRefundIncidentAttempts(admin, id),
  ]);

  if (incidentError) {
    return (
      <div>
        <AdminPageHeader
          eyebrow="Refunds"
          title="Incident introuvable"
          error={incidentError}
        />
      </div>
    );
  }

  if (!incident) {
    notFound();
  }

  const actionable = isRefundIncidentActionable(incident.status);
  const attempts = attemptsRes.attempts;

  return (
    <div>
      <AdminPageHeader
        eyebrow="Refunds"
        title={`Incident ${incident.orderCode ?? incident.id.slice(0, 8)}`}
        subtitle={`${formatAmount(incident.amountCents)} - ${getRefundIncidentStatusLabel(
          incident.status,
        )}`}
        error={attemptsRes.error}
      />

      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-serif text-lg text-gray-900">Incident</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">
              Type
            </dt>
            <dd className="text-gray-900">
              {getRefundIncidentKindLabel(incident.kind)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">
              Statut
            </dt>
            <dd className="text-gray-900">
              {getRefundIncidentStatusLabel(incident.status)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">
              PaymentIntent
            </dt>
            <dd className="font-mono text-xs text-gray-700">
              {incident.paymentIntentId}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">
              Tentatives
            </dt>
            <dd className="text-gray-900">
              {incident.retryCount} / {incident.maxRetries}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">
              Premier échec
            </dt>
            <dd className="text-gray-700">
              {formatDateTimeFr(incident.firstFailedEventAt)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">
              Créé le
            </dt>
            <dd className="text-gray-700">{formatDateFr(incident.createdAt)}</dd>
          </div>
          {incident.lastErrorCode ? (
            <div className="col-span-2">
              <dt className="text-xs uppercase tracking-wide text-gray-500">
                Dernière erreur ({incident.lastErrorCode})
              </dt>
              <dd className="text-gray-700">
                {incident.lastErrorMessage ?? "—"}
              </dd>
            </div>
          ) : null}
          {incident.blockedReason ? (
            <div className="col-span-2">
              <dt className="text-xs uppercase tracking-wide text-gray-500">
                Raison de blocage
              </dt>
              <dd className="text-gray-700">{incident.blockedReason}</dd>
            </div>
          ) : null}
          {incident.resolvedAt ? (
            <div>
              <dt className="text-xs uppercase tracking-wide text-gray-500">
                Résolu le
              </dt>
              <dd className="text-gray-700">
                {formatDateTimeFr(incident.resolvedAt)}
              </dd>
            </div>
          ) : null}
          {incident.resolutionNote ? (
            <div className="col-span-2">
              <dt className="text-xs uppercase tracking-wide text-gray-500">
                Note de résolution
              </dt>
              <dd className="whitespace-pre-wrap text-gray-700">
                {incident.resolutionNote}
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="mb-6 rounded-lg border border-gray-200 bg-white shadow-sm">
        <h2 className="border-b border-gray-200 px-5 py-4 font-serif text-lg text-gray-900">
          Tentatives ({attempts.length})
        </h2>
        {attempts.length === 0 ? (
          <p className="px-5 py-6 text-sm text-gray-500">
            Aucune tentative enregistrée.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-600">
              <tr>
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Issue</th>
                <th className="px-4 py-3">Code erreur</th>
                <th className="px-4 py-3">Message</th>
                <th className="px-4 py-3">Stripe IDs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {attempts.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-3 text-gray-700">
                    {a.attemptNumber}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {formatDateTimeFr(a.attemptedAt)}
                  </td>
                  <td className="px-4 py-3 text-gray-900">{a.outcome}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {a.stripeErrorCode ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {a.stripeErrorMessage ?? "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">
                    {a.stripeRefundId ?? a.stripeRequestId ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-serif text-lg text-gray-900">Action</h2>
        {actionable ? (
          <ResolveIncidentModalLauncher incidentId={incident.id} />
        ) : (
          <p className="text-sm text-gray-600">
            Incident dans le statut{" "}
            <span className="font-semibold">
              {getRefundIncidentStatusLabel(incident.status)}
            </span>{" "}
            — non actionnable depuis cette surface.
          </p>
        )}
      </section>
    </div>
  );
}
