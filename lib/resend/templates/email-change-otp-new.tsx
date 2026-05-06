import { EmailLayout, emailTheme } from "./layout";

// Email envoyé à la NOUVELLE adresse au step 2 du flow A3 change_email
// (T-013 PR2). Vérifie que le destinataire a bien accès à cette adresse
// (preuve possession). Code OTP 6 chiffres, validité 10 min, jamais
// persisté en clair (HMAC en DB côté server).
//
// Pattern aligné lib/resend/templates/email-change-otp-current.tsx (même
// fichier sœur, mais ne révèle pas l'ancienne adresse — l'user à cette
// adresse n'a pas besoin de connaître l'ancienne pour décider de son
// consentement).

export interface Props {
  otpCode: string;
}

export const subject = (_p: Props) =>
  "TerrOir — confirme ta nouvelle adresse email";

export default function EmailChangeOtpNew(props: Props) {
  return (
    <EmailLayout title={subject(props)}>
      <h1 style={{ color: emailTheme.green, marginTop: 0 }}>
        Confirme ta nouvelle adresse
      </h1>
      <p>
        Cette adresse email vient d&apos;être désignée comme nouvelle adresse
        principale d&apos;un compte TerrOir.
      </p>
      <p>
        Pour finaliser le changement, saisis ce code dans l&apos;app (cette
        étape vérifie que tu as bien accès à cette adresse) :
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
        email. Sans confirmation, ton adresse ne sera pas associée à un
        compte.
      </p>
    </EmailLayout>
  );
}
