import { EmailLayout, emailTheme } from "./layout";

// Audit Stripe L-5 (2026-05-05) : alerte admin quand un producer émet un
// refund total sur une de ses commandes ≥ SUPPORT_REFUND_THRESHOLD_EUR
// (default 100€). Pas de cap, pas d'approval — juste un signal de visibilité
// pour détection abus producer (cas problématique : producer qui refund
// toutes ses commandes pour fuir la commission TerrOir).

export interface Props {
  codeCommande: string | null;
  amount: number;
  threshold: number;
  refundId: string;
  orderId: string;
  producerId: string;
  dashboardUrl: string;
}

export const subject = (p: Props) =>
  `[TerrOir Admin] Refund producer ${p.amount.toFixed(2)}€ — commande ${
    p.codeCommande ?? p.orderId.slice(0, 8)
  }`;

export default function AdminProducerRefundAlert(props: Props) {
  return (
    <EmailLayout title={subject(props)}>
      <h1 style={{ color: emailTheme.terracotta, marginTop: 0 }}>
        Refund producer ≥ {props.threshold}€
      </h1>

      <p>
        Un producer a émis un refund total sur une de ses commandes pour un
        montant supérieur au seuil de visibilité. Pas d'action requise — c'est
        un signal forensique pour détecter d'éventuels abus.
      </p>

      <p style={{ margin: "8px 0" }}>
        <strong>Montant remboursé :</strong> {props.amount.toFixed(2)}€
      </p>
      <p style={{ margin: "8px 0" }}>
        <strong>Commande :</strong> {props.codeCommande ?? props.orderId}
      </p>
      <p style={{ margin: "8px 0" }}>
        <strong>Producer ID :</strong> {props.producerId}
      </p>
      <p style={{ margin: "8px 0", color: "#6b6b6b", fontSize: 13 }}>
        Refund ID Stripe : {props.refundId}
      </p>

      <hr style={{ border: 0, borderTop: "1px solid #eee", margin: "20px 0" }} />

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
          Ouvrir refund Stripe
        </a>
      </div>
    </EmailLayout>
  );
}
