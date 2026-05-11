import { EmailLayout, emailTheme } from "./layout";

// Email envoyé à l'ANCIENNE adresse APRÈS finalisation du flow A3
// change_email (post-step 3 completeEmailChangeAction). Defense-in-depth
// F-037 (audit pré-launch 2026-05-11) : si un attaquant a eu accès aux
// 2 boîtes pendant la fenêtre OTP (10 min × 2), aucune trace résiduelle
// ne subsiste après-coup. Cette notification finale laisse l'ancienne
// adresse au courant du fait accompli + canal support si action non
// reconnue.
//
// Note : la notification est informative, le changement est DÉJÀ fait.
// La voie de recours = contact support (réversion manuelle si litige).

export interface Props {
  newEmailMasked: string;
}

export const subject = (_p: Props) =>
  "TerrOir — l'email de ton compte a été changé";

export default function EmailChangedNotice(props: Props) {
  return (
    <EmailLayout title={subject(props)}>
      <h1 style={{ color: emailTheme.green, marginTop: 0 }}>
        Ton email a été changé
      </h1>
      <p>
        L&apos;adresse email associée à ton compte TerrOir a été modifiée.
        La nouvelle adresse principale est <strong>{props.newEmailMasked}</strong>.
      </p>
      <p>
        Tu reçois cet email à ton ANCIENNE adresse comme confirmation finale
        de l&apos;opération. Aucune action n&apos;est requise de ta part si
        tu es bien à l&apos;origine de cette demande.
      </p>
      <hr
        style={{
          border: 0,
          borderTop: "1px solid #e5e5e5",
          margin: "24px 0 12px",
        }}
      />
      <p style={{ fontSize: 13, color: "#6b6b6b", lineHeight: 1.5 }}>
        <strong>Si ce n&apos;était pas toi</strong>, contacte
        immédiatement le support TerrOir. Le changement est déjà finalisé
        — seul le support peut le réverter manuellement après vérification
        d&apos;identité.
      </p>
    </EmailLayout>
  );
}
