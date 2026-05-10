import { EmailLayout, emailTheme } from "./layout";

// F-014 (audit pré-launch 2026-05-10) — alerte admin URGENTE quand un
// producer tente d'émettre un refund supérieur au cap dur (default 500€,
// env PRODUCER_REFUND_CAP_EUR). La tentative est bloquée par 403 côté API
// AVANT l'appel stripe.refunds.create. Cet email signale qu'un producer
// peut être en train d'abuser : compromis, mal intentionné, ou erreur de
// manipulation. Action admin requise (vérifier producer + débloquer
// manuellement si légitime via Dashboard Stripe).

export interface Props {
  codeCommande: string | null;
  attemptedAmount: number;
  cap: number;
  orderId: string;
  producerId: string;
}

export const subject = (p: Props) =>
  `[TerrOir Admin] ⚠️ Refund producer BLOQUÉ ${p.attemptedAmount.toFixed(2)}€ > cap ${p.cap}€ — commande ${
    p.codeCommande ?? p.orderId.slice(0, 8)
  }`;

export default function AdminProducerRefundCapExceeded(props: Props) {
  return (
    <EmailLayout title={subject(props)}>
      <h1 style={{ color: emailTheme.terracotta, marginTop: 0 }}>
        ⚠️ Tentative de refund au-dessus du cap producer
      </h1>

      <p>
        Un producer a tenté un refund total sur une de ses commandes pour un
        montant supérieur au plafond dur autorisé. La requête a été{" "}
        <strong>bloquée par 403</strong> côté API — aucun refund Stripe émis.
      </p>

      <p style={{ margin: "8px 0" }}>
        <strong>Montant tenté :</strong> {props.attemptedAmount.toFixed(2)}€
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

      <hr style={{ border: 0, borderTop: "1px solid #eee", margin: "20px 0" }} />

      <p style={{ color: "#6b6b6b", fontSize: 13 }}>
        Action admin :
        <br />
        1. Vérifier l&rsquo;activité récente du producer (refunds passés, plaintes,
        tentatives multiples).
        <br />
        2. Si refund légitime (ex: gros panier viande), émettre manuellement
        depuis Dashboard Stripe.
        <br />
        3. Si suspect, suspendre le compte Stripe Connect du producer + ouvrir
        ticket sécurité.
      </p>
    </EmailLayout>
  );
}
