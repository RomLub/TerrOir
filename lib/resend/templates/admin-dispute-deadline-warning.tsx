import { EmailLayout, emailTheme } from "./layout";

// Audit Stripe M-2 (2026-05-05) : relance admin disputes ouvertes proches de
// la deadline `evidence_due_by`. Émis par le cron quotidien
// /api/cron/disputes-deadline-check :
//   - urgency='soon'   : evidence_due_by dans 24h–72h.
//   - urgency='urgent' : evidence_due_by dans <24h (+ SMS Twilio si configuré).
// Sans soumission de preuves avant la deadline, Stripe perd automatiquement
// le litige et retire les fonds + commission Stripe + chargeback fee 15€.

export interface Props {
  codeCommande: string | null;
  amount: number;
  currency: string;
  reason: string | null;
  evidenceDueBy: string | null;
  hoursRemaining: number;
  disputeId: string;
  dashboardUrl: string;
  urgency: "soon" | "urgent";
}

export const subject = (p: Props) => {
  const prefix = p.urgency === "urgent" ? "URGENT 24h" : "Rappel";
  if (p.evidenceDueBy) {
    return `[TerrOir Admin] ⚠️ ${prefix} — dispute deadline ${p.evidenceDueBy}`;
  }
  return `[TerrOir Admin] ⚠️ ${prefix} — dispute deadline approche`;
};

export default function AdminDisputeDeadlineWarning(props: Props) {
  const isUrgent = props.urgency === "urgent";
  const headline = isUrgent
    ? "URGENT — moins de 24h pour soumettre l'evidence"
    : "Rappel — deadline dispute approche";

  return (
    <EmailLayout title={subject(props)}>
      <h1 style={{ color: emailTheme.terracotta, marginTop: 0 }}>
        ⚠️ {headline}
      </h1>

      <p>
        Une dispute Stripe ouverte sur TerrOir n'a toujours pas reçu d'evidence.
        Sans soumission avant la deadline, Stripe perd automatiquement le
        litige et retire les fonds + commission Stripe.
      </p>

      <p style={{ margin: "8px 0" }}>
        <strong>Commande :</strong> {props.codeCommande ?? "introuvable côté DB"}
      </p>
      <p style={{ margin: "8px 0" }}>
        <strong>Montant contesté :</strong> {props.amount.toFixed(2)}{" "}
        {props.currency.toUpperCase()}
      </p>
      <p style={{ margin: "8px 0" }}>
        <strong>Raison Stripe :</strong> {props.reason ?? "non précisée"}
      </p>
      <p
        style={{
          margin: "12px 0",
          padding: "8px 12px",
          backgroundColor: isUrgent ? "#ffe4e1" : "#fff4e5",
          borderLeft: `3px solid ${emailTheme.terracotta}`,
          fontWeight: 600,
        }}
      >
        Deadline : {props.evidenceDueBy ?? "inconnue"} (~
        {props.hoursRemaining}h restantes)
      </p>
      <p style={{ margin: "8px 0", color: "#6b6b6b", fontSize: 13 }}>
        Dispute ID : {props.disputeId}
      </p>

      <hr style={{ border: 0, borderTop: "1px solid #eee", margin: "20px 0" }} />

      <p>
        <strong>Action requise :</strong> ouvrir Dashboard Stripe et soumettre
        les preuves (proof of delivery, échanges client, photos produits…)
        AVANT la deadline.
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
