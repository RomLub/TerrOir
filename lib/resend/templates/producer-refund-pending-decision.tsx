import { EmailLayout, emailTheme } from "./layout";

// F-014 v2 (audit P0 sweep 2026-05-11) — Notification producer après
// décision admin sur sa demande de refund > cap. Email unifié : le caller
// passe decision = 'approved' | 'denied' | 'expired' (+ optionnel reason).

export interface Props {
  decision: "approved" | "denied" | "expired";
  codeCommande: string | null;
  amount: number;
  orderId: string;
  decisionReason: string | null;
}

const HEADLINES: Record<Props["decision"], string> = {
  approved: "✅ Votre demande de refund a été approuvée",
  denied: "❌ Votre demande de refund a été refusée",
  expired: "⏱️ Votre demande de refund a expiré",
};

const BODIES: Record<Props["decision"], string> = {
  approved:
    "L'équipe TerrOir a approuvé votre demande de refund. Le remboursement a été émis à votre client via Stripe.",
  denied:
    "L'équipe TerrOir a refusé votre demande de refund. Le motif est précisé ci-dessous.",
  expired:
    "Votre demande de refund n'a pas été décidée dans les 7 jours et a été automatiquement clôturée. Si la demande reste légitime, vous pouvez la ressoumettre.",
};

export const subject = (p: Props) => {
  const code = p.codeCommande ?? p.orderId.slice(0, 8);
  if (p.decision === "approved") {
    return `[TerrOir] Refund approuvé pour la commande ${code}`;
  }
  if (p.decision === "denied") {
    return `[TerrOir] Refund refusé pour la commande ${code}`;
  }
  return `[TerrOir] Refund expiré pour la commande ${code}`;
};

export default function ProducerRefundPendingDecision(props: Props) {
  return (
    <EmailLayout title={subject(props)}>
      <h1 style={{ color: emailTheme.terracotta, marginTop: 0 }}>
        {HEADLINES[props.decision]}
      </h1>

      <p>{BODIES[props.decision]}</p>

      <p style={{ margin: "8px 0" }}>
        <strong>Commande :</strong> {props.codeCommande ?? props.orderId}
      </p>
      <p style={{ margin: "8px 0" }}>
        <strong>Montant :</strong> {props.amount.toFixed(2)}€
      </p>
      {props.decisionReason ? (
        <p style={{ margin: "8px 0" }}>
          <strong>Motif :</strong> {props.decisionReason}
        </p>
      ) : null}

      <hr style={{ border: 0, borderTop: "1px solid #eee", margin: "20px 0" }} />

      <p style={{ color: "#6b6b6b", fontSize: 13 }}>
        Pour toute question, contactez le support TerrOir.
      </p>
    </EmailLayout>
  );
}
