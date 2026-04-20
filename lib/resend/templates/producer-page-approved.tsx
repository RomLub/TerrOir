import { EmailLayout, emailTheme } from "./layout";

export interface Props {
  exploitation: string;
  producerPageUrl: string;
}

export const subject = (p: Props) =>
  `Votre page ${p.exploitation} est en ligne sur TerrOir`;

export default function ProducerPageApproved(props: Props) {
  return (
    <EmailLayout title={subject(props)}>
      <h1 style={{ color: emailTheme.green, marginTop: 0 }}>Félicitations !</h1>
      <p>
        Votre page <strong>{props.exploitation}</strong> vient d&apos;être validée
        par l&apos;équipe TerrOir. Elle est maintenant visible publiquement.
      </p>
      <p>
        <a
          href={props.producerPageUrl}
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
          Voir ma page publique
        </a>
      </p>
      <p>
        N&apos;hésitez pas à partager ce lien à vos clients et sur vos réseaux pour
        recevoir vos premières commandes.
      </p>
    </EmailLayout>
  );
}
