import { EmailLayout, emailTheme } from "./layout";

// Email envoyé à l'ANCIENNE adresse au step 1 du flow A3 change_email
// (T-013 PR2). Vérifie l'identité de l'user qui initie le changement
// (preuve qu'il a toujours accès à l'adresse actuelle). Code OTP 6 chiffres,
// validité 10 min, jamais persisté en clair (HMAC en DB côté server).
//
// Pattern aligné lib/resend/templates/stock-alert-confirm.tsx : Props
// camelCase, subject exporté, EmailLayout wrapper, emailTheme tokens.
//
// La nouvelle adresse cible est affichée dans le corps du mail comme garde-
// fou supplémentaire : si l'user voit `<random>@attacker.com` au lieu de
// l'adresse qu'il a saisie, il sait qu'il y a un problème (compte
// compromis ou phishing).

export interface Props {
  otpCode: string;
  newEmail: string;
}

export const subject = (_p: Props) =>
  "TerrOir — code de vérification pour changer ton email";

export default function EmailChangeOtpCurrent(props: Props) {
  return (
    <EmailLayout title={subject(props)}>
      <h1 style={{ color: emailTheme.green, marginTop: 0 }}>
        Confirme le changement d&apos;email
      </h1>
      <p>
        Tu (ou quelqu&apos;un avec accès à ton compte) as demandé à
        changer l&apos;adresse email de ton compte TerrOir vers{" "}
        <strong>{props.newEmail}</strong>.
      </p>
      <p>
        Pour confirmer que cette demande vient bien de toi, saisis ce code
        dans l&apos;app (cette étape vérifie ton adresse actuelle) :
      </p>
      <p
        style={{
          margin: "20px 0",
          padding: "20px",
          backgroundColor: emailTheme.bg,
          borderRadius: 8,
          textAlign: "center",
          fontSize: 32,
          fontWeight: 700,
          letterSpacing: 6,
          fontFamily: "Menlo, Consolas, 'Courier New', monospace",
          color: emailTheme.green,
        }}
      >
        {props.otpCode}
      </p>
      <p style={{ fontSize: 13, color: "#6b6b6b" }}>
        Ce code expire dans <strong>10 minutes</strong>.
      </p>
      <hr
        style={{
          border: 0,
          borderTop: "1px solid #e5e5e5",
          margin: "24px 0 12px",
        }}
      />
      <p style={{ fontSize: 11, color: "#8a8a8a", lineHeight: 1.5 }}>
        Si tu n&apos;es pas à l&apos;origine de cette demande, ignore cet
        email. Aucune modification ne sera apportée à ton compte. Si cette
        situation se répète, contacte le support.
      </p>
    </EmailLayout>
  );
}
