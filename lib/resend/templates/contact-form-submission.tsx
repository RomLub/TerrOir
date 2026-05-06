import { EmailLayout, emailTheme } from "./layout";

// Email envoyé à l'équipe TerrOir (contact@terroir-local.fr) après chaque
// soumission valide du formulaire /contact. Pas de double opt-in : la
// destination est interne, pas un consumer/producer. Le ReplyTo est positionné
// côté caller (route handler) sur l'email du visiteur — un clic "Répondre"
// dans la boîte mail répond directement au visiteur.
//
// Pattern aligné lib/resend/templates/stock-alert-confirm.tsx :
//   - Props camelCase typés
//   - Subject exporté en fonction
//   - EmailLayout wrapper + emailTheme tokens

export interface Props {
  sujet: string;
  sujetLabel: string;
  nom: string;
  email: string;
  telephone: string | null;
  message: string;
  submittedAt: string; // ISO
  ipAddress: string | null;
}

export const subject = (p: Props) =>
  `[TerrOir Contact] ${p.sujetLabel} — ${p.nom}`;

export default function ContactFormSubmission(props: Props) {
  const dateLabel = new Date(props.submittedAt).toLocaleString("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  });

  const rowStyle: React.CSSProperties = {
    padding: "10px 14px",
    borderBottom: "1px solid #eee",
    fontSize: 14,
  };
  const labelStyle: React.CSSProperties = {
    width: 120,
    color: "#6b6b6b",
    fontWeight: 600,
  };

  return (
    <EmailLayout title={subject(props)}>
      <h1 style={{ color: emailTheme.green, marginTop: 0, marginBottom: 8 }}>
        Nouveau message
      </h1>
      <p style={{ marginTop: 0, color: "#6b6b6b" }}>
        Reçu via le formulaire <strong>/contact</strong> le {dateLabel}.
      </p>

      <table
        role="presentation"
        cellPadding={0}
        cellSpacing={0}
        width="100%"
        style={{
          marginTop: 16,
          borderCollapse: "collapse",
          backgroundColor: "#fafafa",
          borderRadius: 6,
          overflow: "hidden",
        }}
      >
        <tbody>
          <tr style={rowStyle}>
            <td style={labelStyle}>Sujet</td>
            <td>{props.sujetLabel}</td>
          </tr>
          <tr style={rowStyle}>
            <td style={labelStyle}>Nom</td>
            <td>{props.nom}</td>
          </tr>
          <tr style={rowStyle}>
            <td style={labelStyle}>Email</td>
            <td>
              <a
                href={`mailto:${props.email}`}
                style={{ color: emailTheme.green }}
              >
                {props.email}
              </a>
            </td>
          </tr>
          {props.telephone ? (
            <tr style={rowStyle}>
              <td style={labelStyle}>Téléphone</td>
              <td>
                <a
                  href={`tel:${props.telephone.replace(/\s/g, "")}`}
                  style={{ color: emailTheme.green }}
                >
                  {props.telephone}
                </a>
              </td>
            </tr>
          ) : null}
          <tr style={{ ...rowStyle, borderBottom: "none" }}>
            <td style={labelStyle}>IP</td>
            <td style={{ fontFamily: "monospace", fontSize: 12 }}>
              {props.ipAddress ?? "(inconnue)"}
            </td>
          </tr>
        </tbody>
      </table>

      <h2
        style={{
          marginTop: 24,
          marginBottom: 8,
          fontSize: 16,
          color: emailTheme.green,
        }}
      >
        Message
      </h2>
      <p
        style={{
          backgroundColor: emailTheme.bg,
          padding: "14px 16px",
          borderRadius: 6,
          fontSize: 14,
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
        }}
      >
        {props.message}
      </p>

      <hr
        style={{ border: 0, borderTop: "1px solid #e5e5e5", margin: "24px 0 12px" }}
      />
      <p style={{ fontSize: 11, color: "#8a8a8a", lineHeight: 1.5 }}>
        Pour répondre directement au visiteur, utilise la fonction
        « Répondre » de ton client mail — l&apos;adresse Reply-To est
        positionnée sur {props.email}.
      </p>
    </EmailLayout>
  );
}
