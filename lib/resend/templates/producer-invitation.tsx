import { EmailLayout, emailTheme } from "./layout";

export interface Props {
  invitationUrl: string;
  unsubscribeUrl: string;
  senderName?: string | null;
}

export const subject = () => "Votre invitation pour rejoindre TerrOir";

export default function ProducerInvitation(props: Props) {
  return (
    <EmailLayout title={subject()}>
      <h1 style={{ color: emailTheme.green, marginTop: 0 }}>
        Rejoignez TerrOir
      </h1>
      <p>
        {props.senderName ?? "L'équipe TerrOir"} vous invite à créer votre
        page producteur sur TerrOir, la marketplace des produits du terroir.
      </p>
      <p>
        Ce lien est personnel et expire dans 7 jours.
      </p>
      <p>
        <a
          href={props.invitationUrl}
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
          Activer mon compte
        </a>
      </p>
      <p style={{ fontSize: 12, color: "#6b6b6b" }}>
        Lien direct : {props.invitationUrl}
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
