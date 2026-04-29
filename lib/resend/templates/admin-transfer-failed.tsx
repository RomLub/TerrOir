import { EmailLayout, emailTheme } from "./layout";

// Template d'alerte admin (T-401) : un Transfer Stripe Connect (plateforme
// -> compte Connect producteur) a échoué. Stripe ne re-tente pas
// automatiquement les transfers. Action admin requise via Dashboard Stripe
// Connect (retry manuel + investigation cause : KYC, plafonds, banque
// destination).
//
// Pas de consumer côté webhook : Stripe Connect Express n'émet pas l'event
// transfer.failed parce que stripe.transfers.create() est synchrone (succès
// ou throw immédiat). Ce template sera consommé par lib/stripe/payouts.ts
// dans le catch synchrone post-stripe.transfers.create() (Bundle 2 PR 2b
// TC) — le row payouts y sera passé statut='failed', avec waitUntil(
// sendTemplate({ template: 'admin_transfer_failed', ... })).

export interface Props {
  exploitation: string | null;
  amount: number; // euros (numeric, déjà converti centimes -> euros côté handler)
  currency: string;
  transferId: string;
  failureMessage: string | null;
  failureCode: string | null;
  dashboardUrl: string;
}

export const subject = (p: Props) =>
  `[TerrOir Admin] Transfer Stripe échoué — ${p.exploitation ?? "producteur inconnu"}`;

export default function AdminTransferFailed(props: Props) {
  return (
    <EmailLayout title={subject(props)}>
      <h1 style={{ color: emailTheme.terracotta, marginTop: 0 }}>
        ⚠️ Transfer Stripe échoué
      </h1>

      <p>
        Le transfert plateforme → compte Connect producteur a échoué. Le row{" "}
        <code>payouts</code> associé a été marqué <strong>failed</strong>.
      </p>

      <p style={{ margin: "8px 0" }}>
        <strong>Producteur :</strong> {props.exploitation ?? "inconnu"}
      </p>
      <p style={{ margin: "8px 0" }}>
        <strong>Montant :</strong> {props.amount.toFixed(2)} {props.currency.toUpperCase()}
      </p>
      <p style={{ margin: "8px 0" }}>
        <strong>Transfer ID :</strong> {props.transferId}
      </p>
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
        <strong>Action requise :</strong> investiguer la cause (KYC compte
        Connect, plafonds, banque destination) puis retry manuel via Dashboard
        Stripe.
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
