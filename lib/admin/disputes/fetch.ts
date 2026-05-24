import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe/server";
import {
  type AdminDisputeRow,
  type DisputeStatus,
  type DisputeLive,
  type DisputeEvidenceFields,
  EMPTY_EVIDENCE,
  RESPONDABLE_STATUSES,
} from "./types";

// Chantier 8 — helpers service_role pour la surface admin Litiges.
//   - Liste / détail : depuis la table public.disputes (alimentée par le
//     webhook charge.dispute.*) + jointure order pour le code commande.
//   - État live : stripe.disputes.retrieve pour l'échéance, le nombre de
//     soumissions et les preuves déjà saisies (préremplissage du formulaire).

type RawDispute = {
  id: string;
  stripe_dispute_id: string;
  order_id: string;
  status: DisputeStatus;
  reason: string | null;
  amount: number | string;
  currency: string;
  evidence_due_by: string | null;
  closed_at: string | null;
  created_at: string;
  order: { code_commande: string | null } | Array<{ code_commande: string | null }> | null;
};

function mapRow(d: RawDispute): AdminDisputeRow {
  const order = Array.isArray(d.order) ? d.order[0] : d.order;
  return {
    id: d.id,
    stripeDisputeId: d.stripe_dispute_id,
    orderId: d.order_id,
    orderCode: order?.code_commande ?? null,
    status: d.status,
    reason: d.reason,
    amount: Number(d.amount),
    currency: d.currency,
    evidenceDueBy: d.evidence_due_by,
    closedAt: d.closed_at,
    createdAt: d.created_at,
  };
}

const SELECT =
  "id, stripe_dispute_id, order_id, status, reason, amount, currency, evidence_due_by, closed_at, created_at, order:order_id ( code_commande )";

export async function fetchAdminDisputesList(
  admin: SupabaseClient,
): Promise<{ rows: AdminDisputeRow[]; error: string | null }> {
  const { data, error } = await admin
    .from("disputes")
    .select(SELECT)
    // Ouverts (closed_at null) en premier, puis les plus récents.
    .order("closed_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return { rows: [], error: error.message };
  return {
    rows: ((data ?? []) as unknown as RawDispute[]).map(mapRow),
    error: null,
  };
}

export async function fetchAdminDisputeDetail(
  admin: SupabaseClient,
  id: string,
): Promise<{ row: AdminDisputeRow | null; error: string | null }> {
  const { data, error } = await admin
    .from("disputes")
    .select(SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) return { row: null, error: error.message };
  if (!data) return { row: null, error: null };
  return { row: mapRow(data as unknown as RawDispute), error: null };
}

function evidenceFromStripe(ev: Stripe.Dispute.Evidence | null): DisputeEvidenceFields {
  if (!ev) return { ...EMPTY_EVIDENCE };
  return {
    product_description: ev.product_description ?? "",
    customer_name: ev.customer_name ?? "",
    customer_email_address: ev.customer_email_address ?? "",
    service_date: ev.service_date ?? "",
    uncategorized_text: ev.uncategorized_text ?? "",
  };
}

// État live Stripe. Fail-safe : retourne null si l'API échoue (la page
// affiche alors les données DB sans le formulaire de preuves).
export async function fetchStripeDisputeLive(
  stripeDisputeId: string,
): Promise<DisputeLive | null> {
  try {
    const d = await stripe.disputes.retrieve(stripeDisputeId);
    const details = d.evidence_details;
    return {
      status: d.status,
      dueBy: details?.due_by ? new Date(details.due_by * 1000).toISOString() : null,
      submissionCount: details?.submission_count ?? 0,
      hasEvidence: details?.has_evidence ?? false,
      submittable: (RESPONDABLE_STATUSES as string[]).includes(d.status),
      evidence: evidenceFromStripe(d.evidence ?? null),
    };
  } catch (err) {
    console.error(
      `[ADMIN_DISPUTE_STRIPE_RETRIEVE_ERR] dispute=${stripeDisputeId} ${(err as Error).message}`,
    );
    return null;
  }
}
