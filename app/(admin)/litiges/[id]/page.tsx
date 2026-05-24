import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminPageHeader } from "@/components/ui/admin-page-header";
import { Badge } from "@/components/ui/badge";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatDateFr } from "@/lib/format/date";
import {
  fetchAdminDisputeDetail,
  fetchStripeDisputeLive,
} from "@/lib/admin/disputes/fetch";
import {
  DISPUTE_STATUS_LABEL,
  type DisputeStatus,
} from "@/lib/admin/disputes/types";
import { DisputeEvidenceForm } from "./_components/DisputeEvidenceForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const STATUS_VARIANT: Record<DisputeStatus, "green" | "terra" | "danger" | "gray"> = {
  needs_response: "terra",
  warning_needs_response: "terra",
  under_review: "gray",
  warning_under_review: "gray",
  won: "green",
  lost: "danger",
  warning_closed: "gray",
};

export default async function AdminLitigeDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const admin = createSupabaseAdminClient();
  const { row, error } = await fetchAdminDisputeDetail(admin, id);

  if (!error && !row) notFound();

  // État live Stripe (preuves + échéance + soumissibilité). Fail-safe : null
  // si l'API échoue → on affiche la fiche DB sans le formulaire.
  const live = row ? await fetchStripeDisputeLive(row.stripeDisputeId) : null;

  return (
    <div>
      <AdminPageHeader
        eyebrow="Litiges"
        title={row ? `Litige ${row.orderCode ?? row.stripeDisputeId}` : "Litige"}
        subtitle={row ? `Motif : ${row.reason ?? "non précisé"}` : undefined}
        error={error}
        right={
          <Link href="/litiges" className="text-[13px] text-gray-500 underline hover:text-gray-700">
            ← Tous les litiges
          </Link>
        }
      />

      {row ? (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 rounded-md border border-gray-200 bg-white p-5 shadow-sm sm:grid-cols-4">
            <Info label="Statut">
              <Badge variant={STATUS_VARIANT[row.status]}>
                {DISPUTE_STATUS_LABEL[row.status]}
              </Badge>
            </Info>
            <Info label="Montant">
              {row.amount.toFixed(2)} {row.currency.toUpperCase()}
            </Info>
            <Info label="Échéance preuves">
              {row.evidenceDueBy ? formatDateFr(row.evidenceDueBy) : "—"}
            </Info>
            <Info label="Ouvert le">{formatDateFr(row.createdAt)}</Info>
            <Info label="Commande">{row.orderCode ?? "—"}</Info>
            <Info label="Dispute Stripe">
              <span className="font-mono text-[12px] text-gray-500">{row.stripeDisputeId}</span>
            </Info>
            {live ? (
              <Info label="Soumissions">{live.submissionCount}</Info>
            ) : null}
          </div>

          {!live ? (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              Impossible de récupérer l&rsquo;état live Stripe de ce litige. La
              soumission de preuves est momentanément indisponible — réessayez
              plus tard.
            </p>
          ) : live.submittable ? (
            <DisputeEvidenceForm
              disputeId={row.id}
              initialEvidence={live.evidence}
              dueBy={live.dueBy}
              submissionCount={live.submissionCount}
            />
          ) : (
            <div className="rounded-md border border-gray-200 bg-white p-5 shadow-sm">
              <p className="text-sm text-gray-600">
                Ce litige n&rsquo;accepte plus de preuves
                {live.submissionCount > 0 ? " (preuves déjà soumises)" : ""} — statut
                actuel : <strong>{DISPUTE_STATUS_LABEL[row.status]}</strong>.
              </p>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.12em] text-gray-400">{label}</div>
      <div className="mt-1 text-gray-800">{children}</div>
    </div>
  );
}
