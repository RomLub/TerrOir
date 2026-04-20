import { EmailLayout, emailTheme } from "./layout";
import type { OrderItemLine } from "./order-confirmed-consumer";

export interface Props {
  codeCommande: string;
  customerPrenom: string;
  customerNom: string;
  customerEmail: string;
  customerTelephone: string | null;
  dateRetrait: string;
  heureRetrait: string;
  items: OrderItemLine[];
  total: number;
  confirmUrl: string;
  cancelUrl: string;
}

export const subject = (p: Props) =>
  `Nouvelle commande ${p.codeCommande} — à confirmer sous 24h`;

export default function OrderConfirmedProducer(props: Props) {
  return (
    <EmailLayout title={subject(props)}>
      <h1 style={{ color: emailTheme.green, marginTop: 0 }}>
        Nouvelle commande
      </h1>
      <p>
        <strong>
          {props.customerPrenom} {props.customerNom}
        </strong>{" "}
        vient de passer une commande. Merci de la confirmer sous 24h.
      </p>

      <p style={{ margin: "8px 0" }}>
        <strong>Code :</strong> {props.codeCommande}
      </p>
      <p style={{ margin: "8px 0" }}>
        <strong>Créneau :</strong> {props.dateRetrait} à {props.heureRetrait}
      </p>
      <p style={{ margin: "8px 0" }}>
        <strong>Contact :</strong>{" "}
        <a href={`mailto:${props.customerEmail}`}>{props.customerEmail}</a>
        {props.customerTelephone ? ` — ${props.customerTelephone}` : ""}
      </p>

      <hr style={{ border: 0, borderTop: "1px solid #eee", margin: "20px 0" }} />
      <h3 style={{ margin: "0 0 8px" }}>Contenu</h3>
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

      <div style={{ marginTop: 24 }}>
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
            marginRight: 8,
          }}
        >
          Confirmer
        </a>
        <a
          href={props.cancelUrl}
          style={{
            display: "inline-block",
            padding: "12px 20px",
            backgroundColor: "#fff",
            color: emailTheme.terracotta,
            textDecoration: "none",
            borderRadius: 6,
            fontWeight: 600,
            border: `1px solid ${emailTheme.terracotta}`,
          }}
        >
          Annuler
        </a>
      </div>
    </EmailLayout>
  );
}
