import { EmailLayout, emailTheme } from "./layout";

// Chantier 3 — Relance auto R3 (J+20, dernier rappel + abandon imminent) pour
// lead spontané. Trame validée Romain (phase 0.2) : objet « archivée », ton
// ferme mais pas agressif.

export interface Props {
  ctaUrl: string;
  unsubscribeUrl: string;
  prenom?: string | null;
}

export const subject = () => "Dernier rappel : votre demande d'inscription va être archivée";

export default function LeadRelance3(props: Props) {
  const bonjour = props.prenom ? `Bonjour ${props.prenom},` : "Bonjour,";
  return (
    <EmailLayout title={subject()}>
      <h1 style={{ color: emailTheme.green, marginTop: 0 }}>
        Dernier rappel
      </h1>
      <p>{bonjour}</p>
      <p>
        Sans action de votre part, votre demande d&rsquo;inscription à TerrOir
        sera prochainement archivée. Si vous souhaitez toujours nous rejoindre
        et vendre en direct aux consommateurs de la Sarthe, il vous suffit de
        finaliser votre espace dès maintenant.
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
          Reprendre mon inscription
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
