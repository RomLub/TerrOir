import { EmailLayout, emailTheme } from "./layout";

export interface OrderItemLine {
  nom: string;
  quantite: number;
  unite: string;
  sousTotal: number;
}

export interface Props {
  codeCommande: string;
  exploitation: string;
  dateRetrait: string;
  heureRetrait: string;
  adresse: string;
  mapsUrl: string;
  items: OrderItemLine[];
  total: number;
}

export const subject = (p: Props) =>
  `Votre commande ${p.codeCommande} est confirmée`;

export default function OrderConfirmedConsumer(props: Props) {
  return (
    <EmailLayout title={subject(props)}>
      <h1 style={{ color: emailTheme.green, marginTop: 0 }}>
        Commande confirmée
      </h1>
      <p>
        Votre producteur a confirmé votre commande. À retirer sur place, frais
        du jour.
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
            fontSize: 32,
            fontWeight: 800,
            letterSpacing: 2,
            color: emailTheme.green,
          }}
        >
          {props.codeCommande}
        </div>
      </div>

      <p style={{ margin: "8px 0" }}>
        <strong>Retrait :</strong> {props.dateRetrait} à {props.heureRetrait}
      </p>
      <p style={{ margin: "8px 0" }}>
        <strong>Chez :</strong> {props.exploitation}
      </p>
      <p style={{ margin: "8px 0" }}>
        <strong>Adresse :</strong> {props.adresse}
      </p>
      <p style={{ margin: "12px 0" }}>
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

      <hr style={{ border: 0, borderTop: "1px solid #eee", margin: "20px 0" }} />
      <h3 style={{ margin: "0 0 8px" }}>Récapitulatif</h3>
      <table width="100%" cellPadding={4} style={{ fontSize: 14 }}>
        <tbody>
          {props.items.map((it, i) => (
            <tr key={i}>
              <td>
                {it.nom} — {it.quantite} {it.unite}
              </td>
              <td align="right">{it.sousTotal.toFixed(2)} €</td>
            </tr>
          ))}
          <tr>
            <td style={{ paddingTop: 8, fontWeight: 700 }}>Total</td>
            <td align="right" style={{ paddingTop: 8, fontWeight: 700 }}>
              {props.total.toFixed(2)} €
            </td>
          </tr>
        </tbody>
      </table>
    </EmailLayout>
  );
}
