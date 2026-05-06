import { EmailLayout, emailTheme } from "./layout";

export interface Props {
  codeCommande: string;
  exploitation: string;
  dateRetrait: string;
  heureRetrait: string;
  adresse: string;
  mapsUrl: string;
}

export const subject = (p: Props) =>
  `Rappel : retrait demain chez ${p.exploitation}`;

export default function OrderReminderConsumer(props: Props) {
  return (
    <EmailLayout title={subject(props)}>
      <h1 style={{ color: emailTheme.green, marginTop: 0 }}>
        Retrait prévu demain
      </h1>
      <p>
        Petit rappel : ta commande chez <strong>{props.exploitation}</strong>{" "}
        t&rsquo;attend demain.
      </p>

      <div
        style={{
          margin: "16px 0",
          padding: "16px",
          backgroundColor: emailTheme.bg,
          borderRadius: 6,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 12, color: "#6b6b6b" }}>Code commande</div>
        <div
          style={{
            fontSize: 28,
            fontWeight: 800,
            letterSpacing: 2,
            color: emailTheme.green,
          }}
        >
          {props.codeCommande}
        </div>
      </div>

      <p>
        <strong>Quand :</strong> {props.dateRetrait} à {props.heureRetrait}
      </p>
      <p>
        <strong>Où :</strong> {props.adresse}
      </p>
      <p>
        <a
          href={props.mapsUrl}
          style={{
            display: "inline-block",
            padding: "10px 16px",
            backgroundColor: emailTheme.green,
            color: "#fff",
            textDecoration: "none",
            borderRadius: 6,
            fontWeight: 600,
          }}
        >
          Itinéraire Google Maps
        </a>
      </p>
    </EmailLayout>
  );
}
