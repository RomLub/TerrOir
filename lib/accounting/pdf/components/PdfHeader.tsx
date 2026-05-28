import type { ProducerAccountingExportData } from "@/lib/accounting/producer-export-data";
import { PdfBrandHeader } from "@/lib/accounting/pdf/components/PdfBrandHeader";
import { formatPdfDateTime } from "@/lib/accounting/pdf/theme";

export function PdfHeader({
  data,
  logoSrc,
}: {
  data: ProducerAccountingExportData;
  logoSrc: string;
}) {
  return (
    <PdfBrandHeader
      logoSrc={logoSrc}
      eyebrow="Document producteur"
      title="Relevé d'activité TerrOir"
      subtitle="Relevé comptable"
      info={[
        { label: "Producteur", value: data.producer.name },
        { label: "Exploitation", value: data.producer.exploitation },
        { label: "SIRET", value: data.producer.siret ?? "Non renseigné" },
        { label: "Généré le", value: formatPdfDateTime(data.generatedAt) },
        { label: "Période", value: data.period.label, wide: true },
      ]}
    />
  );
}
