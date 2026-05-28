import { PageHeader } from "@/components/ui/page-header";
import { ComptabiliteClient } from "./ComptabiliteClient";

export default function ComptabilitePage() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
      <PageHeader
        tone="producer"
        eyebrow="Comptabilité"
        title="Export comptable"
        subtitle="Télécharge l'historique de tes commandes validées sur la période choisie."
      />

      <ComptabiliteClient />
    </div>
  );
}
