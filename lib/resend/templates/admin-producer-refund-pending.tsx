import { EmailLayout, emailTheme } from "./layout";

// F-014 v2 (audit P0 sweep 2026-05-11) — Notification admin URGENTE : un
// producer a tenté un refund au-dessus du cap (default 500€). Au lieu du 403
// historique, la demande est mise en pending_refunds. Admin doit approuver
// ou refuser via /admin/refunds/pending.

export interface Props {
  pendingRefundId: string;
  codeCommande: string | null;
  amount: number;
  cap: number;
  orderId: string;
  producerId: string;
  reason: string | null;
  reviewUrl: string;
}

export const subject = (p: Props) =>
  `[TerrOir Admin] ⚠️ Approbation requise : refund ${p.amount.toFixed(2)}€ > cap ${p.cap}€ — commande ${
    p.codeCommande ?? p.orderId.slice(0, 8)
  }`;

export default function AdminProducerRefundPending(props: Props) {
  return (
    <EmailLayout title={subject(props)}>
      <h1 style={{ color: emailTheme.terracotta, marginTop: 0 }}>
        ⚠️ Demande de refund producer en attente d&rsquo;approbation
      </h1>

      <p>
        Un producer a demandé un refund au-dessus du plafond dur autorisé. La
        requête est <strong>en attente de votre décision</strong> — aucun refund
        Stripe émis tant qu&rsquo;un admin n&rsquo;approuve pas.
      </p>

      <p style={{ margin: "8px 0" }}>
        <strong>Montant demandé :</strong> {props.amount.toFixed(2)}€
      </p>
      <p style={{ margin: "8px 0" }}>
        <strong>Plafond actuel :</strong> {props.cap.toFixed(2)}€
      </p>
      <p style={{ margin: "8px 0" }}>
        <strong>Commande :</strong> {props.codeCommande ?? props.orderId}
      </p>
      <p style={{ margin: "8px 0" }}>
        <strong>Producer ID :</strong> {props.producerId}
      </p>
      {props.reason ? (
        <p style={{ margin: "8px 0" }}>
          <strong>Motif producer :</strong> {props.reason}
        </p>
      ) : null}

      <p style={{ margin: "16px 0" }}>
        <a
          href={props.reviewUrl}
          style={{
            background: emailTheme.terracotta,
            color: "white",
            padding: "10px 18px",
            borderRadius: 4,
            textDecoration: "none",
            display: "inline-block",
          }}
        >
          Examiner la demande
        </a>
      </p>

      <hr style={{ border: 0, borderTop: "1px solid #eee", margin: "20px 0" }} />

      <p style={{ color: "#6b6b6b", fontSize: 13 }}>
        Une demande non décidée sous <strong>7 jours</strong> est
        automatiquement expirée (le producer doit ressoumettre si toujours
        légitime). Cf. cron <code>refund-expire-pending</code>.
      </p>
    </EmailLayout>
  );
}
