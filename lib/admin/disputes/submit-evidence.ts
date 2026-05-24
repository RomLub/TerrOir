import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe/server";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";
import {
  type DisputeEvidenceFields,
  type DisputeStatus,
  RESPONDABLE_STATUSES,
} from "./types";

// Chantier 8 — enregistrement / soumission des preuves d'un litige depuis la
// page admin Litiges.
//   - submit=false : brouillon (Stripe enregistre les preuves, modifiable).
//   - submit=true  : soumission DÉFINITIVE → le litige passe under_review,
//     plus aucune modification possible (irréversible côté Stripe).
//
// Garde : seuls les litiges en needs_response / warning_needs_response
// acceptent des preuves. Service_role (disputes sans policy write).

export type SubmitEvidenceResult = { ok: true } | { ok: false; error: string };

const EVIDENCE_KEYS: (keyof DisputeEvidenceFields)[] = [
  "product_description",
  "customer_name",
  "customer_email_address",
  "service_date",
  "uncategorized_text",
];

export async function submitDisputeEvidence(
  admin: SupabaseClient,
  actorId: string,
  disputeRowId: string,
  evidence: DisputeEvidenceFields,
  submit: boolean,
): Promise<SubmitEvidenceResult> {
  // 1. Charge la row pour récupérer stripe_dispute_id + statut + order.
  const { data: row, error: loadErr } = await admin
    .from("disputes")
    .select("stripe_dispute_id, status, order_id")
    .eq("id", disputeRowId)
    .maybeSingle();

  if (loadErr) {
    console.error(`[ADMIN_DISPUTE_LOAD_ERR] ${loadErr.message}`);
    return { ok: false, error: "Erreur de chargement du litige." };
  }
  if (!row) return { ok: false, error: "Litige introuvable." };

  const r = row as { stripe_dispute_id: string; status: DisputeStatus; order_id: string };
  if (!(RESPONDABLE_STATUSES as string[]).includes(r.status)) {
    return {
      ok: false,
      error:
        "Ce litige n'accepte plus de preuves (déjà soumis, en examen ou clôturé).",
    };
  }

  // 2. Construit l'objet evidence (la totalité des champs du formulaire = la
  //    source de vérité ; un champ vide efface la preuve correspondante).
  const evidencePayload: Record<string, string> = {};
  let fieldsSet = 0;
  for (const k of EVIDENCE_KEYS) {
    const v = (evidence[k] ?? "").trim();
    evidencePayload[k] = v;
    if (v) fieldsSet += 1;
  }

  // 3. Soumission définitive : exige au moins une preuve (Stripe rejette une
  //    soumission vide, et c'est irréversible).
  if (submit && fieldsSet === 0) {
    return {
      ok: false,
      error: "Ajoutez au moins une preuve avant de soumettre définitivement.",
    };
  }

  // 4. Stripe update.
  try {
    await stripe.disputes.update(r.stripe_dispute_id, {
      evidence: evidencePayload,
      submit,
    });
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[ADMIN_DISPUTE_UPDATE_ERR] dispute=${r.stripe_dispute_id} ${msg}`);
    return { ok: false, error: `Échec côté Stripe : ${msg}` };
  }

  // 5. Soumission → MAJ optimiste du statut (le webhook charge.dispute.updated
  //    confirmera under_review ; idempotent).
  if (submit) {
    const newStatus =
      r.status === "warning_needs_response" ? "warning_under_review" : "under_review";
    await admin
      .from("disputes")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", disputeRowId);
  }

  // 6. Audit.
  await logPaymentEvent({
    eventType: submit ? "stripe_dispute_evidence_submitted" : "stripe_dispute_evidence_saved",
    userId: actorId,
    metadata: {
      dispute_id: r.stripe_dispute_id,
      order_id: r.order_id,
      fields_set: fieldsSet,
      submit,
    },
  });

  return { ok: true };
}
