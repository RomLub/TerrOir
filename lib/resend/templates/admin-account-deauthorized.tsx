import { EmailLayout, emailTheme } from "./layout";

// Audit Stripe phase 2 M-3 : alerte URGENT admin Connect deauthorization.
// Un producer a déconnecté son Connect account depuis Dashboard Stripe.
// Tous les flags Stripe ont été reset côté DB, le producer est passé en
// statut='suspended' pour empêcher toute commande future. Action admin :
// contacter le producer pour comprendre le motif et offrir un re-onboard.

export interface Props {
  exploitation: string | null;
  producerId: string;
  stripeAccountId: string;
  dashboardUrl: string;
}

export const subject = (p: Props) =>
  `[TerrOir Admin] 🚨 URGENT — Connect account déconnecté (${p.exploitation ?? p.producerId})`;

export default function AdminAccountDeauthorized(props: Props) {
  return (
    <EmailLayout title={subject(props)}>
      <h1 style={{ color: emailTheme.terracotta, marginTop: 0 }}>
        🚨 Connect account déconnecté
      </h1>

      <p>
        Un producer a déconnecté son compte Stripe Connect depuis le Dashboard
        Stripe. TerrOir a automatiquement reset ses flags Connect et l&apos;a
        passé en statut <strong>suspended</strong> — il ne peut plus recevoir de
        nouvelles commandes ni de virements jusqu&apos;à ré-onboarding.
      </p>

      <p style={{ margin: "8px 0" }}>
        <strong>Producer :</strong>{" "}
        {props.exploitation ?? `(non identifié, id=${props.producerId})`}
      </p>
      <p style={{ margin: "8px 0", color: "#6b6b6b", fontSize: 13 }}>
        Producer ID : {props.producerId} — Stripe account : {props.stripeAccountId}
      </p>

      <hr style={{ border: 0, borderTop: "1px solid #eee", margin: "20px 0" }} />

      <p style={{ fontWeight: 600, color: emailTheme.terracotta }}>
        Action requise :
      </p>
      <ul style={{ margin: "8px 0", paddingLeft: 20 }}>
        <li>Contacter le producer pour comprendre le motif (perte de confiance, bug, switch plateforme).</li>
        <li>Si réversible : proposer un ré-onboarding via /api/stripe/connect/onboard (création d&apos;un nouveau Connect account).</li>
        <li>Vérifier qu&apos;aucune commande pending n&apos;est bloquée côté DB pour ce producer.</li>
      </ul>

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
