import { EmailLayout, emailTheme } from "./layout";

// Chantier 3 — Relance auto R1 (J+3, ton léger) pour lead spontané.
// Trame validée Romain (phase 0.2).

export interface Props {
  ctaUrl: string;
  unsubscribeUrl: string;
  prenom?: string | null;
}

export const subject = () => "Votre espace producteur TerrOir vous attend";

export default function LeadRelance1(props: Props) {
  const bonjour = props.prenom ? `Bonjour ${props.prenom},` : "Bonjour,";
  return (
    <EmailLayout title={subject()}>
      <h1 style={{ color: emailTheme.green, marginTop: 0 }}>
        Votre espace producteur vous attend
      </h1>
      <p>{bonjour}</p>
      <p>
        Merci d&rsquo;avoir manifesté votre souhait de rejoindre TerrOir et de
        vendre en circuit court près de chez vous. Il ne reste que quelques
        étapes pour finaliser votre espace et apparaître auprès des
        consommateurs de la Sarthe — comptez quelques minutes.
      </p>
      <p>
        <a
          href={props.ctaUrl}
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
          Finaliser mon espace
        </a>
      </p>
      <p style={{ fontSize: 14, color: "#4b4b4b" }}>
        Besoin d&rsquo;aide pour compléter votre espace producteur ? Notre
        équipe se tient à votre disposition.
      </p>
      <hr style={{ border: 0, borderTop: "1px solid #e5e5e5", margin: "24px 0 12px" }} />
      <p style={{ fontSize: 11, color: "#8a8a8a", lineHeight: 1.5 }}>
        Vous avez reçu cet email car vous avez manifesté votre intérêt pour
        TerrOir.{" "}
        <a href={props.unsubscribeUrl} style={{ color: "#8a8a8a" }}>
          Je ne souhaite plus être contacté
        </a>
        .
      </p>
    </EmailLayout>
  );
}
