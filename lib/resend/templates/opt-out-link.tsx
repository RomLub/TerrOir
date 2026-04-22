import { EmailLayout, emailTheme } from "./layout";

export interface Props {
  unsubscribeUrl: string;
}

export const subject = () =>
  "Votre lien de désabonnement TerrOir";

export default function OptOutLink(props: Props) {
  return (
    <EmailLayout title={subject()}>
      <h1 style={{ color: emailTheme.green, marginTop: 0 }}>
        Lien de désabonnement
      </h1>
      <p>
        Vous avez demandé le lien de désabonnement pour cet email. Cliquez sur
        le bouton ci-dessous pour confirmer la suppression de vos coordonnées
        de notre base leads producteurs.
      </p>
      <p>
        <a
          href={props.unsubscribeUrl}
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
          Se désabonner
        </a>
      </p>
      <p style={{ fontSize: 12, color: "#6b6b6b" }}>
        Lien direct : {props.unsubscribeUrl}
      </p>
      <hr style={{ border: 0, borderTop: "1px solid #e5e5e5", margin: "24px 0 12px" }} />
      <p style={{ fontSize: 11, color: "#8a8a8a", lineHeight: 1.5 }}>
        Conformément au RGPD, vous pouvez à tout moment demander la suppression
        de vos données personnelles. Si vous n&apos;êtes pas à l&apos;origine de
        cette demande, ignorez simplement cet email.
      </p>
    </EmailLayout>
  );
}
