import { StyleSheet, Text, View } from "@react-pdf/renderer";

export function PdfFooter() {
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.legal}>
        Document généré automatiquement par TerrOir. Les paiements sont traités
        via Stripe Connect.
      </Text>
      <Text style={styles.legal}>
        Ce document constitue un relevé récapitulatif et ne remplace pas les
        obligations comptables légales du producteur.
      </Text>
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
    left: 30,
    right: 30,
    bottom: 22,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#e7ded6",
    color: "#66665d",
    fontSize: 7,
  },
  legal: {
    marginBottom: 2,
  },
  pageNumber: {
    position: "absolute",
    right: 0,
    top: 8,
    color: "#2d6a4f",
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
  },
});
