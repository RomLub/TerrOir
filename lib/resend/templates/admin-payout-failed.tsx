import { EmailLayout, emailTheme } from "./layout";

// Template d'alerte admin Bundle 3 (T-401) : un Payout Stripe (Connect
// account -> banque producteur) a échoué. Cause typique : RIB invalide,
// compte banque fermé, montant insuffisant côté Stripe Connect. Le row
// payouts associé a été passé statut='failed' par
// lib/stripe/handle-payout-failed.ts (avec fallback event.account ->
// producers.stripe_account_id si payout.metadata.payout_id absent).

export interface Props {
  exploitation: string | null;
  amount: number; // euros
  currency: string;
  payoutId: string;
  failureMessage: string | null;
  failureCode: string | null;
  arrivalDate: string | null;
  dashboardUrl: string;
}

export const subject = (p: Props) =>
  `[TerrOir Admin] Payout Stripe échoué — ${p.exploitation ?? "producteur inconnu"}`;

export default function AdminPayoutFailed(props: Props) {
  return (
    <EmailLayout title={subject(props)}>
      <h1 style={{ color: emailTheme.terracotta, marginTop: 0 }}>
        ⚠️ Payout Stripe échoué
      </h1>

      <p>
        Le virement compte Connect → banque producteur a échoué. Le row{" "}
        <code>payouts</code> associé a été marqué <strong>failed</strong>.
      </p>

      <p style={{ margin: "8px 0" }}>
        <strong>Producteur :</strong> {props.exploitation ?? "inconnu"}
      </p>
      <p style={{ margin: "8px 0" }}>
        <strong>Montant :</strong> {props.amount.toFixed(2)} {props.currency.toUpperCase()}
      </p>
      <p style={{ margin: "8px 0" }}>
        <strong>Payout ID :</strong> {props.payoutId}
      </p>
      {props.arrivalDate ? (
        <p style={{ margin: "8px 0" }}>
          <strong>Arrival date prévue :</strong> {props.arrivalDate}
        </p>
      ) : null}
      {props.failureCode ? (
        <p style={{ margin: "8px 0" }}>
          <strong>Code Stripe :</strong> {props.failureCode}
        </p>
      ) : null}
      {props.failureMessage ? (
        <p style={{ margin: "8px 0" }}>
          <strong>Message Stripe :</strong> {props.failureMessage}
        </p>
      ) : null}

      <hr style={{ border: 0, borderTop: "1px solid #eee", margin: "20px 0" }} />

      <p>
        <strong>Action requise :</strong> investiguer la cause (RIB invalide,
        banque fermée, plafond) avec le producteur, puis retry manuel via
        Dashboard Stripe Connect.
      </p>

      <div style={{ marginTop: 24 }}>
        <a
          href={props.dashboardUrl}
          style={{
            display: "inline-block",
            padding: "12px 20px",
            backgroundColor: emailTheme.green,
            color: "#fff",
            textDecoration: "none",
            borderRadius: 6,
            fontWeight: 600,
          }}
        >
          Ouvrir Dashboard Stripe
        </a>
      </div>
    </EmailLayout>
  );
}
