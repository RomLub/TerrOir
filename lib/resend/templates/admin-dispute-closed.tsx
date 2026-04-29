import { EmailLayout, emailTheme } from "./layout";

// Template d'info admin Bundle 3 (T-403 extended) : un dispute Stripe vient
// d'être clos. Pas d'urgence (résolution finale, pas de deadline). Info-only,
// le row disputes a déjà été mis à jour côté DB (closed_at posé).

export type DisputeOutcome = "won" | "lost" | "warning_closed";

export interface Props {
  outcome: DisputeOutcome;
  codeCommande: string | null;
  amount: number;
  currency: string;
  reason: string | null;
  disputeId: string;
  dashboardUrl: string;
}

const OUTCOME_LABEL: Record<DisputeOutcome, string> = {
  won: "gagnée — fonds récupérés",
  lost: "perdue — fonds retirés",
  warning_closed: "warning Visa CE3.0 closed (info-only)",
};

const OUTCOME_COLOR: Record<DisputeOutcome, string> = {
  won: "#2D6A4F", // green
  lost: "#A0522D", // terracotta
  warning_closed: "#6b6b6b", // gray
};

export const subject = (p: Props) =>
  `[TerrOir Admin] Dispute ${OUTCOME_LABEL[p.outcome]}`;

export default function AdminDisputeClosed(props: Props) {
  return (
    <EmailLayout title={subject(props)}>
      <h1
        style={{
          color: OUTCOME_COLOR[props.outcome],
          marginTop: 0,
        }}
      >
        Dispute clôturée — {OUTCOME_LABEL[props.outcome]}
      </h1>

      <p>
        Le dispute Stripe a été clos. Cet email est information-only, aucune
        action requise.
      </p>

      <p style={{ margin: "8px 0" }}>
        <strong>Commande :</strong> {props.codeCommande ?? "introuvable côté DB"}
      </p>
      <p style={{ margin: "8px 0" }}>
        <strong>Montant :</strong> {props.amount.toFixed(2)}{" "}
        {props.currency.toUpperCase()}
      </p>
      <p style={{ margin: "8px 0" }}>
        <strong>Raison Stripe :</strong> {props.reason ?? "non précisée"}
      </p>
      <p style={{ margin: "8px 0", color: "#6b6b6b", fontSize: 13 }}>
        Dispute ID : {props.disputeId}
      </p>

      <hr style={{ border: 0, borderTop: "1px solid #eee", margin: "20px 0" }} />

      <div style={{ marginTop: 20 }}>
        <a
          href={props.dashboardUrl}
          style={{
            display: "inline-block",
            padding: "10px 16px",
            backgroundColor: emailTheme.green,
            color: "#fff",
            textDecoration: "none",
            borderRadius: 6,
            fontWeight: 600,
          }}
        >
          Voir détails Dashboard Stripe
        </a>
      </div>
    </EmailLayout>
  );
}
