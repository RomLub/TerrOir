import { EmailLayout, emailTheme } from "./layout";

// Chantier 3 — Relance auto R2 (J+10, plus pressant) pour lead spontané.
// Trame validée Romain (phase 0.2).

export interface Props {
  ctaUrl: string;
  unsubscribeUrl: string;
  prenom?: string | null;
}

export const subject = () => "Il ne manque plus grand-chose à votre profil TerrOir";

export default function LeadRelance2(props: Props) {
  const bonjour = props.prenom ? `Bonjour ${props.prenom},` : "Bonjour,";
  return (
    <EmailLayout title={subject()}>
      <h1 style={{ color: emailTheme.green, marginTop: 0 }}>
        Votre profil est presque prêt
      </h1>
      <p>{bonjour}</p>
      <p>
        Votre profil producteur est presque prêt, mais il est encore
        incomplet : tant qu&rsquo;il n&rsquo;est pas finalisé, les
        consommateurs proches de chez vous ne peuvent pas vous trouver ni
        commander vos produits. Quelques minutes suffisent pour le rendre
        visible.
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
          Compléter mon profil
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
