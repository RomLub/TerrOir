// Chantier 8 — types de la surface admin Litiges (disputes Stripe).

export type DisputeStatus =
  | "needs_response"
  | "under_review"
  | "won"
  | "lost"
  | "warning_closed"
  | "warning_needs_response"
  | "warning_under_review";

// Statuts « ouverts » = nécessitent attention / en cours (non terminaux).
export const OPEN_DISPUTE_STATUSES: DisputeStatus[] = [
  "needs_response",
  "under_review",
  "warning_needs_response",
  "warning_under_review",
];

// Statuts où l'admin peut encore soumettre des preuves.
export const RESPONDABLE_STATUSES: DisputeStatus[] = [
  "needs_response",
  "warning_needs_response",
];

export const DISPUTE_STATUS_LABEL: Record<DisputeStatus, string> = {
  needs_response: "Réponse attendue",
  under_review: "En cours d'examen",
  won: "Gagné",
  lost: "Perdu",
  warning_closed: "Alerte clôturée",
  warning_needs_response: "Alerte — réponse attendue",
  warning_under_review: "Alerte — en examen",
};

export type AdminDisputeRow = {
  id: string;
  stripeDisputeId: string;
  orderId: string;
  orderCode: string | null;
  status: DisputeStatus;
  reason: string | null;
  amount: number;
  currency: string;
  evidenceDueBy: string | null;
  closedAt: string | null;
  createdAt: string;
};

// Champs de preuve exposés dans le formulaire admin (sous-ensemble texte
// pertinent pour une marketplace en retrait : pas d'expédition). Tous
// optionnels côté Stripe.
export type DisputeEvidenceFields = {
  product_description: string;
  customer_name: string;
  customer_email_address: string;
  service_date: string;
  uncategorized_text: string;
};

export const EMPTY_EVIDENCE: DisputeEvidenceFields = {
  product_description: "",
  customer_name: "",
  customer_email_address: "",
  service_date: "",
  uncategorized_text: "",
};

// État live récupéré via stripe.disputes.retrieve pour la page détail.
export type DisputeLive = {
  status: string;
  dueBy: string | null; // ISO (evidence_details.due_by)
  submissionCount: number;
  hasEvidence: boolean;
  submittable: boolean;
  evidence: DisputeEvidenceFields;
};
