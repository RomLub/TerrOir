import { EmailLayout, emailTheme } from "./layout";

// Template Resend pour le cas pathologique où une commande revient en
// résurrection 3DS-retry (PI succeeded après payment_failed) MAIS la
// ressource n'est plus disponible :
//   - stock : un produit du panier a été épuisé entre le 3DS-fail initial
//     et la validation finale (autre client a passé commande entre temps).
//   - slot : le créneau de retrait a été pris (capacité saturée) ou
//     supprimé entre temps.
//
// Dans les deux cas, Stripe a encaissé puis le webhook a auto-déclenché
// un refund total (cf handle-payment-succeeded.ts commit 9d6cb13). L'order
// reste en cancelled avec closure_reason='revival_blocked_stock' ou
// 'revival_blocked_slot' pour drill-down côté admin et exclusion UI
// consumer.
//
// Wording adapté selon `blockedReason` (1 template avec prop discriminante,
// pas 2 templates dupliqués — la structure est identique, seul le motif
// diffère). L'invitation finale ("repasser commande") est cohérente quel
// que soit le motif.

export interface Props {
  codeCommande: string;
  exploitation: string;
  amount: number;
  blockedReason: "stock" | "slot";
}

export const subject = (p: Props) =>
  `Commande ${p.codeCommande} non honorée — remboursement initié`;

export default function OrderRevivalBlocked(props: Props) {
  const reasonText =
    props.blockedReason === "stock"
      ? "le stock du produit a été épuisé"
      : "le créneau de retrait a été pris par un autre client";
  const fixSuggestion =
    props.blockedReason === "stock"
      ? "repasser commande chez ce producteur ou un autre"
      : "choisir un autre créneau de retrait ou un autre producteur";

  return (
    <EmailLayout title={subject(props)}>
      <h1 style={{ color: emailTheme.terracotta, marginTop: 0 }}>
        Commande non honorée
      </h1>
      <p>
        Bonjour, ta commande <strong>{props.codeCommande}</strong> chez{" "}
        <strong>{props.exploitation}</strong> n&apos;a pas pu être confirmée :{" "}
        {reasonText} entre ta tentative initiale de paiement et la validation
        finale.
      </p>
      <p>
        Un remboursement intégral de{" "}
        <strong>{props.amount.toFixed(2)} €</strong> a été initié sur ton
        moyen de paiement. Compte 3 à 5 jours ouvrés pour voir le crédit
        apparaître.
      </p>
      <p>
        Tu peux {fixSuggestion} — TerrOir reste à ta disposition pour
        ta prochaine commande.
      </p>
    </EmailLayout>
  );
}
