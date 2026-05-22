import { EmailLayout, emailTheme } from "./layout";

// Chantier 3 — Email d'envoi du formulaire à un prospect (route send-form).
// Trame validée Romain (phase 0.2) avec ajout « Lien personnel valable 30
// jours » (cohérent avec l'expiration du prefill_token).

export interface Props {
  ctaUrl: string;
  unsubscribeUrl: string;
  prenom?: string | null;
}

export const subject = () => "Rejoignez TerrOir — votre formulaire d'inscription";

export default function LeadFormInvitation(props: Props) {
  const bonjour = props.prenom ? `Bonjour ${props.prenom},` : "Bonjour,";
  return (
    <EmailLayout title={subject()}>
      <h1 style={{ color: emailTheme.green, marginTop: 0 }}>
        Créez votre espace producteur
      </h1>
      <p>{bonjour}</p>
      <p>
        Suite à notre échange, voici le lien pour créer votre espace producteur
        TerrOir en quelques minutes. Le formulaire est déjà pré-rempli avec les
        informations que nous avons.
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
          Créer mon espace
        </a>
      </p>
      <p style={{ fontSize: 13, color: "#6b6b6b" }}>
        Lien personnel valable 30 jours.
      </p>
      <p style={{ fontSize: 14, color: "#4b4b4b" }}>
        Besoin d&rsquo;aide pour compléter votre espace producteur ? Notre
        équipe se tient à votre disposition.
      </p>
      <hr style={{ border: 0, borderTop: "1px solid #e5e5e5", margin: "24px 0 12px" }} />
      <p style={{ fontSize: 11, color: "#8a8a8a", lineHeight: 1.5 }}>
        Vous recevez cet email suite à un contact avec l&rsquo;équipe TerrOir.{" "}
        <a href={props.unsubscribeUrl} style={{ color: "#8a8a8a" }}>
          Je ne souhaite plus être contacté
        </a>
        .
      </p>
    </EmailLayout>
  );
}
