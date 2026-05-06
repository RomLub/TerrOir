import { EmailLayout, emailTheme } from "./layout";

export interface PayoutOrderLine {
  codeCommande: string;
  dateRetrait: string | null;
  montantBrut: number;
  commission: number;
  montantNet: number;
}

export interface Props {
  periodeDebut: string;
  periodeFin: string;
  orders: PayoutOrderLine[];
  montantBrut: number;
  commission: number;
  montantNet: number;
}

export const subject = (p: Props) =>
  `Virement TerrOir : semaine du ${p.periodeDebut}`;

export default function PayoutSummary(props: Props) {
  return (
    <EmailLayout title={subject(props)}>
      <h1 style={{ color: emailTheme.green, marginTop: 0 }}>
        Virement hebdomadaire
      </h1>
      <p>
        Période du <strong>{props.periodeDebut}</strong> au{" "}
        <strong>{props.periodeFin}</strong>.
      </p>

      <table
        width="100%"
        cellPadding={6}
        style={{ borderCollapse: "collapse", fontSize: 13 }}
      >
        <thead>
          <tr style={{ backgroundColor: emailTheme.bg }}>
            <th align="left">Commande</th>
            <th align="left">Retrait</th>
            <th align="right">Brut</th>
            <th align="right">Comm. 6%</th>
            <th align="right">Net</th>
          </tr>
        </thead>
        <tbody>
          {props.orders.map((o, i) => (
            <tr key={i} style={{ borderTop: "1px solid #eee" }}>
              <td>{o.codeCommande}</td>
              <td>{o.dateRetrait ?? "—"}</td>
              <td align="right">{o.montantBrut.toFixed(2)} €</td>
              <td align="right">{o.commission.toFixed(2)} €</td>
              <td align="right">{o.montantNet.toFixed(2)} €</td>
            </tr>
          ))}
          <tr
            style={{
              borderTop: "2px solid #333",
              fontWeight: 700,
            }}
          >
            <td colSpan={2}>Total</td>
            <td align="right">{props.montantBrut.toFixed(2)} €</td>
            <td align="right">{props.commission.toFixed(2)} €</td>
            <td align="right" style={{ color: emailTheme.green }}>
              {props.montantNet.toFixed(2)} €
            </td>
          </tr>
        </tbody>
      </table>

      <p style={{ marginTop: 16 }}>
        Virement net : <strong>{props.montantNet.toFixed(2)} €</strong>.
        Selon ta banque, compte 1 à 3 jours ouvrés pour la réception.
      </p>
    </EmailLayout>
  );
}
