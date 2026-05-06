import { EmailLayout, emailTheme } from "./layout";

// Email envoyé quand un produit qu'un consumer suit revient en stock. Le
// helper notify-back-in-stock.ts (PUSH 3) sélectionne les alertes éligibles
// (confirmed_at NOT NULL, notified_at IS NULL, unsubscribed_at IS NULL),
// envoie cet email puis UPDATE notified_at = now() pour ne pas re-notifier.
//
// Pattern aligné lib/resend/templates/order-confirmed-consumer.tsx.

export interface Props {
  productName: string;
  productUrl: string;
  // Optionnel : nom du producer pour personnaliser l'annonce ("produit
  // par {nom}"). Si null, on n'affiche pas la mention.
  producerName: string | null;
  unsubscribeUrl: string;
}

export const subject = (p: Props) =>
  `${p.productName} est de retour en stock`;

export default function StockAlertBackInStock(props: Props) {
  return (
    <EmailLayout title={subject(props)}>
      <h1 style={{ color: emailTheme.green, marginTop: 0 }}>
        Bonne nouvelle, c&apos;est de retour !
      </h1>
      <p>
        Le produit que tu suivais vient d&apos;être réapprovisionné :
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
        {props.producerName ? (
          <span
            style={{ display: "block", fontSize: 13, color: "#6b6b6b", fontWeight: 400 }}
          >
            produit par {props.producerName}
          </span>
        ) : null}
      </p>
      <p>
        Le stock est limité — pense à passer commande rapidement si ce
        produit t&rsquo;intéresse toujours.
      </p>
      <p style={{ margin: "20px 0" }}>
        <a
          href={props.productUrl}
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
          Voir le produit
        </a>
      </p>
      <hr
        style={{ border: 0, borderTop: "1px solid #e5e5e5", margin: "24px 0 12px" }}
      />
      <p style={{ fontSize: 11, color: "#8a8a8a", lineHeight: 1.5 }}>
        Tu reçois cet email car tu as créé une alerte stock pour ce
        produit. Cette alerte est désormais consommée et ne se déclenchera plus.{" "}
        <a href={props.unsubscribeUrl} style={{ color: "#8a8a8a" }}>
          Se désabonner de toutes les alertes liées à cette adresse
        </a>
        .
      </p>
    </EmailLayout>
  );
}
