import { EmailLayout, emailTheme } from "./layout";

// Chantier 3 (2026-05) — email de bienvenue après création d'un compte
// producteur via /devenir-producteur (self-service). Le producteur est déjà
// connecté à la soumission ; ce mail récapitule les prochaines étapes et lui
// donne l'URL de son espace (pas un magic link). Ton aligné sur les 4
// templates leads validés.

export interface Props {
  spaceUrl: string;
  unsubscribeUrl: string;
  prenom?: string | null;
}

export const subject = () =>
  "Bienvenue sur TerrOir — votre espace producteur est prêt";

export default function ProducerWelcome(props: Props) {
  const bonjour = props.prenom ? `Bonjour ${props.prenom},` : "Bonjour,";
  return (
    <EmailLayout title={subject()}>
      <h1 style={{ color: emailTheme.green, marginTop: 0 }}>
        Bienvenue sur TerrOir
      </h1>
      <p>{bonjour}</p>
      <p>
        Votre espace producteur est créé. Vous pouvez dès maintenant vous y
        connecter et le compléter pour commencer à vendre en circuit court
        près de chez vous.
      </p>
      <p style={{ fontWeight: 600, marginBottom: 6 }}>Les prochaines étapes :</p>
      <ol style={{ margin: "0 0 8px", paddingLeft: 20, lineHeight: 1.6 }}>
        <li>Complétez votre page (description, photo, commune, créneaux).</li>
        <li>Ajoutez vos produits avec leurs photos.</li>
        <li>
          Demandez la publication : notre équipe valide votre fiche avant sa
          mise en ligne.
        </li>
      </ol>
      <p>
        <a
          href={props.spaceUrl}
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
          Accéder à mon espace
        </a>
      </p>
      <p style={{ fontSize: 13, color: "#6b6b6b" }}>
        Vous pourrez toujours retrouver votre espace à cette adresse :{" "}
        {props.spaceUrl}
      </p>
      <p style={{ fontSize: 14, color: "#4b4b4b" }}>
        Besoin d&rsquo;aide pour compléter votre espace producteur ? Notre
        équipe se tient à votre disposition.
      </p>
      <hr style={{ border: 0, borderTop: "1px solid #e5e5e5", margin: "24px 0 12px" }} />
      <p style={{ fontSize: 11, color: "#8a8a8a", lineHeight: 1.5 }}>
        Vous recevez cet email suite à la création de votre compte producteur
        TerrOir.{" "}
        <a href={props.unsubscribeUrl} style={{ color: "#8a8a8a" }}>
          Je ne souhaite plus être contacté
        </a>
        .
      </p>
    </EmailLayout>
  );
}
