import type { Metadata } from "next";
import { FacturesClient } from "./FacturesClient";

// Page UI factures consumer : sélecteur de période + bouton de téléchargement
// CSV. Le layout (consumer)/compte/layout.tsx ajoute Sidebar + auth-redirect.

export const metadata: Metadata = {
  title: "Factures & comptabilité | TerrOir",
  description:
    "Exporte tes commandes payées sur la période de ton choix au format CSV (compatible Excel, comptables).",
};

export default function FacturesPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-terroir-green-700">
        Factures & comptabilité
      </h1>
      <p className="mt-2 text-sm text-terroir-ink/70">
        Télécharge l&rsquo;historique de tes commandes payées sur une période
        donnée, au format CSV (compatible Excel, Sheets, comptables).
      </p>
      <FacturesClient />
    </div>
  );
}
