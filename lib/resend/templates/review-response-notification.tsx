import { EmailLayout, emailTheme } from "./layout";

export interface Props {
  consumerFirstName: string;
  producerName: string;
  originalReview: string;
  responseText: string;
  producerUrl: string;
  preferencesUrl: string;
}

export const subject = (p: Props) =>
  `[TerrOir] ${p.producerName} a répondu à ton avis`;

// Email notification consumer : producer a répondu à son avis (CGU 6.4).
// Inclut le rappel de l'avis original (extrait court) + le texte complet
// de la réponse + CTA vers la page publique producer + lien désabo.
export default function ReviewResponseNotification(props: Props) {
  const greeting = props.consumerFirstName
    ? `Bonjour ${props.consumerFirstName},`
    : "Bonjour,";

  // Extrait court de l'avis original (max 200 chars). Au-delà on tronque
  // pour garder l'email compact et garder le focus sur la réponse.
  const reviewExcerpt =
    props.originalReview.length > 200
      ? props.originalReview.slice(0, 200) + "…"
      : props.originalReview;

  return (
    <EmailLayout title={subject(props)}>
      <h1 style={{ color: emailTheme.green, marginTop: 0, fontSize: 22 }}>
        {props.producerName} a répondu à ton avis
      </h1>
      <p>{greeting}</p>
      <p>
        Le producteur <strong>{props.producerName}</strong> vient de répondre à
        l&apos;avis que tu as laissé sur sa page TerrOir.
      </p>

      {reviewExcerpt && (
        <div
          style={{
            margin: "20px 0",
            padding: "12px 16px",
            backgroundColor: emailTheme.bg,
            borderLeft: `4px solid ${emailTheme.terracotta}`,
            fontStyle: "italic",
            fontSize: 14,
            color: "#444",
          }}
        >
          <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>
            Ton avis
          </div>
          « {reviewExcerpt} »
        </div>
      )}

      <div
        style={{
          margin: "20px 0",
          padding: "16px",
          backgroundColor: "#fff",
          border: `1px solid ${emailTheme.green}`,
          borderRadius: 6,
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: emailTheme.green,
            marginBottom: 8,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Réponse du producteur
        </div>
        <div style={{ fontSize: 15, lineHeight: 1.55 }}>
          {props.responseText}
        </div>
      </div>

      <p>
        <a
          href={props.producerUrl}
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
          Voir sur TerrOir
        </a>
      </p>

      <p style={{ fontSize: 12, color: "#888", marginTop: 32 }}>
        Tu reçois cet email parce que tu as laissé un avis sur TerrOir.{" "}
        <a href={props.preferencesUrl} style={{ color: emailTheme.green }}>
          Désactiver ces notifications
        </a>
        .
      </p>
    </EmailLayout>
  );
}
