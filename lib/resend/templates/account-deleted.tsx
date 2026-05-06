import { EmailLayout, emailTheme } from "./layout";

export interface Props {
  deletedAt: string;
}

export const subject = (_p: Props) => `Ton compte TerrOir a été supprimé`;

export default function AccountDeleted(props: Props) {
  return (
    <EmailLayout title={subject(props)}>
      <h1 style={{ color: emailTheme.green, marginTop: 0 }}>
        Ton compte a été supprimé
      </h1>
      <p>
        Ton compte TerrOir a été supprimé le{" "}
        <strong>{props.deletedAt}</strong> à ta demande.
      </p>
      <p>
        Toutes tes données personnelles ont été effacées de nos systèmes. Tes
        commandes passées ont été anonymisées pour respecter nos obligations
        comptables (conservation 10 ans, Code de commerce L123-22).
      </p>
      <p style={{ marginTop: 24, fontSize: 13, color: "#6b6b6b" }}>
        Si tu n&apos;es pas à l&apos;origine de cette suppression,
        contacte-nous immédiatement à{" "}
        <a
          href="mailto:admin@terroir-local.fr"
          style={{ color: emailTheme.green }}
        >
          admin@terroir-local.fr
        </a>
        .
      </p>
    </EmailLayout>
  );
}
