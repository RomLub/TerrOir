import { EmailLayout, emailTheme } from "./layout";

// F-042 (audit pré-launch 2026-05-11) — email producer URGENT envoyé quand
// Stripe désactive `charges_enabled` sur le Connect account (KYC re-flagged,
// document expirant, ou autre requirement Stripe). Sans cet email, le
// producer reste aveugle au blocage qui peut prendre des jours et bloque
// toute nouvelle commande (le checkout côté consumer va échouer à la
// création du PaymentIntent).
//
// Stripe expose la raison du blocage via account.requirements.disabled_reason
// (ex: 'requirements.past_due', 'requirements.pending_verification',
// 'rejected.fraud', 'listed') et la liste des informations attendues via
// account.requirements.currently_due (ex: ['individual.id_number',
// 'tos_acceptance.date']). On expose les deux dans l'email pour permettre
// au producer d'agir immédiatement via son Dashboard Connect Express.

export interface Props {
  exploitation: string | null;
  producerId: string;
  stripeAccountId: string;
  disabledReason: string | null;
  currentlyDue: string[];
  dashboardUrl: string;
}

export const subject = (p: Props) =>
  `[TerrOir] Urgent — Votre compte Stripe est temporairement bloqué (${p.exploitation ?? p.producerId})`;

export default function ProducerKycBlocked(props: Props) {
  return (
    <EmailLayout title={subject(props)}>
      <h1 style={{ color: emailTheme.terracotta, marginTop: 0 }}>
        Action requise sur votre compte Stripe
      </h1>

      <p>
        Bonjour{props.exploitation ? `, ${props.exploitation}` : ""},
      </p>

      <p>
        Stripe a temporairement <strong>désactivé l&apos;encaissement des
        paiements</strong> sur votre compte. En conséquence, vos clients ne
        peuvent plus passer commande sur TerrOir jusqu&apos;à régularisation.
      </p>

      {props.disabledReason ? (
        <p style={{ margin: "8px 0" }}>
          <strong>Raison Stripe :</strong> {props.disabledReason}
        </p>
      ) : null}

      {props.currentlyDue.length > 0 ? (
        <>
          <p style={{ margin: "16px 0 8px 0", fontWeight: 600 }}>
            Informations attendues par Stripe :
          </p>
          <ul style={{ margin: "8px 0", paddingLeft: 20 }}>
            {props.currentlyDue.map((req) => (
              <li key={req}>{req}</li>
            ))}
          </ul>
        </>
      ) : null}

      <hr style={{ border: 0, borderTop: "1px solid #eee", margin: "20px 0" }} />

      <p>
        Pour débloquer votre compte, connectez-vous à votre tableau de bord
        Stripe Express et complétez les informations manquantes. Le
        déblocage est généralement automatique sous quelques heures après
        soumission.
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
          Ouvrir mon Dashboard Stripe
        </a>
      </div>

      <p style={{ marginTop: 24, color: "#6b6b6b", fontSize: 13 }}>
        Si vous avez besoin d&apos;aide, contactez l&apos;équipe TerrOir en
        répondant à cet email — nous vous accompagnerons sur la
        régularisation.
      </p>
    </EmailLayout>
  );
}
