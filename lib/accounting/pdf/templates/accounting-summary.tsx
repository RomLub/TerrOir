import { Document, Page, StyleSheet } from "@react-pdf/renderer";
import type { ProducerAccountingExportData } from "@/lib/accounting/producer-export-data";
import { PdfHeader } from "@/lib/accounting/pdf/components/PdfHeader";
import { PdfFooter } from "@/lib/accounting/pdf/components/PdfFooter";
import { SummaryCards } from "@/lib/accounting/pdf/components/SummaryCards";
import { OrdersTable } from "@/lib/accounting/pdf/components/OrdersTable";

export function AccountingSummaryDocument({
  data,
  logoSrc,
}: {
  data: ProducerAccountingExportData;
  logoSrc: string;
}) {
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
  page: {
    paddingTop: 28,
    paddingRight: 30,
    paddingBottom: 76,
    paddingLeft: 30,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: "#243128",
    backgroundColor: "#FFFFFF",
  },
});
