import { EmailLayout, emailTheme } from "./layout";

// Audit Stripe phase 2 M-3 : alerte admin Early Fraud Warning Stripe.
// Visa/MC ont signalé une potentielle fraude AVANT que le client ouvre un
// dispute. TerrOir a refundé pré-emptivement pour éviter chargeback fee
// (~15€) + dispute. L'admin doit être notifié pour suivi et investigation
// (pattern fraude récurrent ? même IP/device ?).

export interface Props {
  codeCommande: string | null;
  fraudType: string;
  actionable: boolean;
  amount: number; // euros
  refundId: string;
  orderId: string;
  efwId: string;
  paymentIntentId: string | null;
  dashboardUrl: string;
}

export const subject = (p: Props) =>
  `[TerrOir Admin] ⚠️ Early Fraud Warning — refund pré-emptif émis (commande ${p.codeCommande ?? p.orderId})`;

export default function AdminEarlyFraudWarning(props: Props) {
  return (
    <EmailLayout title={subject(props)}>
      <h1 style={{ color: emailTheme.terracotta, marginTop: 0 }}>
        ⚠️ Early Fraud Warning Stripe
      </h1>

      <p>
        Visa/MC ont signalé une potentielle fraude sur cette commande AVANT
        l&apos;ouverture d&apos;un dispute. TerrOir a refundé pré-emptivement
        pour éviter le chargeback fee (~15€) + la perte commerce.
      </p>

      <p style={{ margin: "8px 0" }}>
        <strong>Commande :</strong> {props.codeCommande ?? props.orderId}
      </p>
      <p style={{ margin: "8px 0" }}>
        <strong>Montant refundé :</strong> {props.amount.toFixed(2)} EUR
      </p>
      <p style={{ margin: "8px 0" }}>
        <strong>Type de fraude (Stripe) :</strong> {props.fraudType}
      </p>
      <p style={{ margin: "8px 0" }}>
        <strong>Actionable :</strong> {props.actionable ? "oui" : "non"}
      </p>
      <p style={{ margin: "8px 0", color: "#6b6b6b", fontSize: 13 }}>
        EFW ID : {props.efwId} — Refund ID : {props.refundId}
        {props.paymentIntentId ? ` — PI : ${props.paymentIntentId}` : null}
      </p>

      <hr style={{ border: 0, borderTop: "1px solid #eee", margin: "20px 0" }} />

      <p>
        <strong>Action de suivi :</strong> vérifier le pattern (IP, device,
        email consumer) pour détecter une éventuelle attaque coordonnée. Bloquer
        manuellement l&apos;email/IP côté Radar Stripe si récurrence.
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
          Ouvrir Dashboard Stripe
        </a>
      </div>
    </EmailLayout>
  );
}
