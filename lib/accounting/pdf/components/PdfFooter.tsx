import { StyleSheet, Text, View } from "@react-pdf/renderer";
import { pdfColors, pdfFonts, pdfSpacing } from "@/lib/accounting/pdf/theme";

const DEFAULT_LINES = [
  "Document généré automatiquement par TerrOir. Les paiements sont traités via Stripe Connect.",
  "Ce document constitue un relevé récapitulatif et ne remplace pas les obligations comptables légales du producteur.",
];

export function PdfFooter({ lines = DEFAULT_LINES }: { lines?: string[] }) {
  return (
    <View style={styles.footer} fixed>
      {lines.map((line) => (
        <Text key={line} style={styles.legal}>
          {line}
        </Text>
      ))}
      <Text
        style={styles.pageNumber}
        render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    position: "absolute",
    left: pdfSpacing.pageX,
    right: pdfSpacing.pageX,
    bottom: 22,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: pdfColors.border,
    color: pdfColors.mutedWarm,
    fontSize: 7,
  },
  legal: {
    marginBottom: 2,
  },
  pageNumber: {
    position: "absolute",
    right: 0,
    top: 8,
    color: pdfColors.terracotta,
    fontSize: 8,
    fontFamily: pdfFonts.bold,
    fontWeight: "bold",
  },
});
