import { EmailLayout, emailTheme } from "./layout";

// Template d'alerte admin Bundle 3 (T-403) : un dispute (chargeback) Stripe
// vient d'être ouvert sur une commande. Action admin requise AVANT la
// deadline evidence_due_by, sinon Stripe perd la dispute par défaut et
// retire les fonds + commission Stripe.
//
// Subject : ⚠️ urgence visuelle — Romain doit ouvrir dans la journée et
// aller poser des preuves côté Dashboard Stripe Disputes.

export interface Props {
  codeCommande: string | null;
  customerEmail: string | null;
  amount: number; // euros
  currency: string;
  reason: string | null;
  evidenceDueBy: string | null; // ISO date string formatée pour humain
  disputeId: string;
  dashboardUrl: string;
}

export const subject = (p: Props) =>
  p.evidenceDueBy
    ? `[TerrOir Admin] ⚠️ Dispute client — action requise avant le ${p.evidenceDueBy}`
    : `[TerrOir Admin] ⚠️ Dispute client — action requise`;

export default function AdminDisputeActionRequired(props: Props) {
  return (
    <EmailLayout title={subject(props)}>
      <h1 style={{ color: emailTheme.terracotta, marginTop: 0 }}>
        ⚠️ Dispute client — action requise
      </h1>

      <p>
        Un client a contesté une commande auprès de sa banque (chargeback). Sans
        soumission de preuves avant la deadline, Stripe perd automatiquement le
        litige et retire les fonds.
      </p>

      <p style={{ margin: "8px 0" }}>
        <strong>Commande :</strong> {props.codeCommande ?? "introuvable côté DB"}
      </p>
      {props.customerEmail ? (
        <p style={{ margin: "8px 0" }}>
          <strong>Client :</strong>{" "}
          <a href={`mailto:${props.customerEmail}`}>{props.customerEmail}</a>
        </p>
      ) : null}
      <p style={{ margin: "8px 0" }}>
        <strong>Montant contesté :</strong> {props.amount.toFixed(2)}{" "}
        {props.currency.toUpperCase()}
      </p>
      <p style={{ margin: "8px 0" }}>
        <strong>Raison Stripe :</strong> {props.reason ?? "non précisée"}
      </p>
      {props.evidenceDueBy ? (
        <p
          style={{
            margin: "12px 0",
            padding: "8px 12px",
            backgroundColor: "#fff4e5",
            borderLeft: `3px solid ${emailTheme.terracotta}`,
            fontWeight: 600,
          }}
        >
          Deadline evidence : {props.evidenceDueBy}
        </p>
      ) : null}
      <p style={{ margin: "8px 0", color: "#6b6b6b", fontSize: 13 }}>
        Dispute ID : {props.disputeId}
      </p>

      <hr style={{ border: 0, borderTop: "1px solid #eee", margin: "20px 0" }} />

      <p>
        <strong>Action requise :</strong> ouvrir Dashboard Stripe et soumettre
        les preuves nécessaires (proof of delivery, échanges client, photos
        produits…) AVANT la deadline.
      </p>

      <div style={{ marginTop: 24 }}>
        <a
          href={props.dashboardUrl}
          style={{
            display: "inline-block",
            padding: "12px 20px",
            backgroundColor: emailTheme.terracotta,
            color: "#fff",
            textDecoration: "none",
            borderRadius: 6,
            fontWeight: 600,
          }}
        >
          Soumettre evidence Stripe
        </a>
      </div>
    </EmailLayout>
  );
}
