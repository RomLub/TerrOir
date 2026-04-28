import { EmailLayout, emailTheme } from "./layout";

// Email envoyé après création d'une alerte stock dispo. Double opt-in :
// le consumer doit cliquer le bouton pour confirmer (sinon l'alerte est
// purgée par le cron daily 7 jours plus tard, cf. PUSH 4).
//
// Pattern aligné lib/resend/templates/order-confirmed-consumer.tsx :
//   - Props camelCase typés
//   - Subject exporté en fonction (utilisé côté sendTemplate)
//   - EmailLayout wrapper + emailTheme tokens
//   - Default export = composant template

export interface Props {
  productName: string;
  productUrl: string;
  confirmUrl: string;
  unsubscribeUrl: string;
}

export const subject = (p: Props) =>
  `Confirmez votre alerte stock — ${p.productName}`;

export default function StockAlertConfirm(props: Props) {
  return (
    <EmailLayout title={subject(props)}>
      <h1 style={{ color: emailTheme.green, marginTop: 0 }}>
        Confirmez votre alerte
      </h1>
      <p>
        Vous avez demandé à être prévenu(e) au retour en stock de ce produit :
      </p>
      <p
        style={{
          margin: "16px 0",
          padding: "12px 16px",
          backgroundColor: emailTheme.bg,
          borderRadius: 6,
          fontSize: 16,
          fontWeight: 600,
        }}
      >
        <a
          href={props.productUrl}
          style={{ color: emailTheme.green, textDecoration: "none" }}
        >
          {props.productName}
        </a>
      </p>
      <p>
        Pour activer votre alerte, cliquez sur le bouton ci-dessous. Sans cette
        confirmation, votre demande sera automatiquement supprimée sous 7 jours.
      </p>
      <p style={{ margin: "20px 0" }}>
        <a
          href={props.confirmUrl}
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
          Confirmer l&apos;alerte
        </a>
      </p>
      <p style={{ fontSize: 12, color: "#6b6b6b" }}>
        Lien direct : {props.confirmUrl}
      </p>
      <hr
        style={{ border: 0, borderTop: "1px solid #e5e5e5", margin: "24px 0 12px" }}
      />
      <p style={{ fontSize: 11, color: "#8a8a8a", lineHeight: 1.5 }}>
        Si vous n&apos;êtes pas à l&apos;origine de cette demande, ignorez
        simplement cet email — votre adresse ne sera pas conservée.{" "}
        <a href={props.unsubscribeUrl} style={{ color: "#8a8a8a" }}>
          Se désabonner immédiatement
        </a>
        .
      </p>
    </EmailLayout>
  );
}
