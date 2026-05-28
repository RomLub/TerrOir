import { Document, Page, StyleSheet } from "@react-pdf/renderer";
import type { ProducerAccountingExportData } from "@/lib/accounting/producer-export-data";
import { PdfHeader } from "@/lib/accounting/pdf/components/PdfHeader";
import { PdfFooter } from "@/lib/accounting/pdf/components/PdfFooter";
import { SummaryCards } from "@/lib/accounting/pdf/components/SummaryCards";
import { OrdersTable } from "@/lib/accounting/pdf/components/OrdersTable";
import {
  pdfPageStyle,
  registerPdfFonts,
} from "@/lib/accounting/pdf/theme";

export function AccountingSummaryDocument({
  data,
  logoSrc,
}: {
  data: ProducerAccountingExportData;
  logoSrc: string;
}) {
  registerPdfFonts();

  return (
    <Document
      title={`Relevé d'activité TerrOir - ${data.producer.exploitation}`}
      author="TerrOir"
      creator="TerrOir"
      producer="TerrOir"
      subject="Relevé comptable producteur"
      language="fr-FR"
    >
      <Page size="A4" style={styles.page} wrap>
        <PdfHeader data={data} logoSrc={logoSrc} />
        <SummaryCards summary={data.summary} />
        <OrdersTable orders={data.orders} />
        <PdfFooter />
      </Page>
    </Document>
  );
}

const styles = StyleSheet.create({
  page: pdfPageStyle,
});
