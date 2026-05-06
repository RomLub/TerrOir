import { EmailLayout, emailTheme } from "./layout";

export interface Props {
  codeCommande: string;
  exploitation: string;
  reviewUrl: string;
  dayOffset: 0 | 2 | 7;
}

export const subject = (p: Props) => {
  if (p.dayOffset === 0) return `Laisse un avis sur ${p.exploitation}`;
  if (p.dayOffset === 2) return `Ton avis compte — ${p.exploitation}`;
  return `Dernière invitation : partage ton avis sur ${p.exploitation}`;
};

export default function ReviewRequest(props: Props) {
  const intro =
    props.dayOffset === 0
      ? "Merci d'avoir commandé sur TerrOir. Comment s'est passé ton retrait ?"
      : props.dayOffset === 2
        ? "On ne veut pas insister, mais ton retour aide les producteurs."
        : "Dernière relance — ton avis reste précieux pour la communauté.";

  return (
    <EmailLayout title={subject(props)}>
      <h1 style={{ color: emailTheme.green, marginTop: 0 }}>
        Ton avis sur {props.exploitation}
      </h1>
      <p>{intro}</p>
      <p>Commande : <strong>{props.codeCommande}</strong></p>
      <p>
        <a
          href={props.reviewUrl}
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
          Laisser un avis
        </a>
      </p>
    </EmailLayout>
  );
}
