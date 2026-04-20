import { EmailLayout, emailTheme } from "./layout";

export interface Props {
  codeCommande: string;
  exploitation: string;
  amount: number;
}

export const subject = (p: Props) =>
  `Commande ${p.codeCommande} annulée et remboursée`;

export default function OrderTimeoutCancelled(props: Props) {
  return (
    <EmailLayout title={subject(props)}>
      <h1 style={{ color: emailTheme.terracotta, marginTop: 0 }}>
        Commande annulée
      </h1>
      <p>
        Nous sommes désolés : votre commande{" "}
        <strong>{props.codeCommande}</strong> chez{" "}
        <strong>{props.exploitation}</strong> n&apos;a pas été confirmée dans les 24h.
      </p>
      <p>
        Elle a été automatiquement annulée et un remboursement intégral de{" "}
        <strong>{props.amount.toFixed(2)} €</strong> a été initié sur votre
        moyen de paiement. Comptez 3 à 5 jours ouvrés pour voir le crédit
        apparaître.
      </p>
      <p>
        N&apos;hésitez pas à passer commande chez un autre producteur TerrOir.
      </p>
    </EmailLayout>
  );
}
