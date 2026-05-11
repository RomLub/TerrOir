import { EmailLayout, emailTheme } from "./layout";

// F-062 (audit pré-launch 2026-05-11) — Email envoyé après tout changement
// de mot de passe (change-password.ts depuis /compte/password ET
// update-password.ts depuis le flow recovery /reinitialiser-mot-de-passe).
// Defense-in-depth : si un attaquant a réussi à changer le mdp (compte
// compromis, recovery hijacking), l'user titulaire reçoit une trace
// post-fait + canal support pour récupération.
//
// Note : la notification est informative, le changement est DÉJÀ fait.
// Voie de recours = contact support (réversion + verrouillage compte
// après vérification d'identité).
//
// Pattern miroir email-changed-notice.tsx (F-037).

export interface Props {
  changedAt: string;
}

export const subject = (_p: Props) =>
  "TerrOir — le mot de passe de ton compte a été modifié";

export default function PasswordChangedNotice(props: Props) {
  return (
    <EmailLayout title={subject(props)}>
      <h1 style={{ color: emailTheme.green, marginTop: 0 }}>
        Ton mot de passe a été modifié
      </h1>
      <p>
        Le mot de passe de ton compte TerrOir a été modifié le{" "}
        <strong>{props.changedAt}</strong>.
      </p>
      <p>
        Tu reçois cet email à titre de confirmation. Aucune action
        n&apos;est requise de ta part si tu es bien à l&apos;origine de
        cette modification.
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
        immédiatement le support TerrOir. Ton compte est probablement
        compromis — le support peut le verrouiller et révoquer les
        sessions actives après vérification d&apos;identité.
      </p>
    </EmailLayout>
  );
}
