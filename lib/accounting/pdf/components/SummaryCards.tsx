import { StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ProducerAccountingSummary } from "@/lib/accounting/producer-export-data";
import {
  formatPdfEuro,
  pdfColors,
  pdfEyebrowStyle,
  pdfFonts,
  pdfSpacing,
} from "@/lib/accounting/pdf/theme";

type CardTone = "neutral" | "accent" | "positive";

export function SummaryCards({
  summary,
}: {
  summary: ProducerAccountingSummary;
}) {
  return (
    <View style={styles.container}>
      <Card label="Commandes" value={String(summary.ordersCount)} tone="neutral" />
      <Card
        label="Chiffre d'affaires TTC"
        value={formatPdfEuro(summary.totalTtc)}
        tone="accent"
      />
      <Card
        label="Commission TerrOir"
        value={formatPdfEuro(summary.terroirCommission)}
        tone="neutral"
      />
      <Card
        label="Net producteur"
        value={formatPdfEuro(summary.producerNet)}
        tone="positive"
      />
    </View>
  );
}

function Card({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: CardTone;
}) {
  const styleByTone = {
    neutral: [styles.card, styles.cardNeutral],
    accent: [styles.card, styles.cardAccent],
    positive: [styles.card, styles.cardPositive],
  }[tone];

  const valueStyleByTone = {
    neutral: styles.value,
    accent: styles.valueAccent,
    positive: styles.valuePositive,
  }[tone];

  return (
    <View style={styleByTone}>
      <Text style={styles.label}>{label}</Text>
      <Text style={valueStyleByTone}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    gap: 8,
    marginBottom: pdfSpacing.sectionGap,
  },
  card: {
    flexGrow: 1,
    flexBasis: 0,
    minHeight: 62,
    borderWidth: 1,
    borderRadius: pdfSpacing.radius,
    padding: pdfSpacing.cardPadding,
    backgroundColor: pdfColors.white,
  },
  cardNeutral: {
    borderColor: pdfColors.border,
  },
  cardAccent: {
    borderColor: pdfColors.terracotta,
    backgroundColor: pdfColors.terracottaPale,
  },
  cardPositive: {
    borderColor: pdfColors.green,
    backgroundColor: pdfColors.greenSoft,
  },
  label: {
    ...pdfEyebrowStyle,
    color: pdfColors.muted,
  },
  value: {
    color: pdfColors.ink,
    fontFamily: pdfFonts.bold,
    fontWeight: "bold",
    fontSize: 12,
    marginTop: 6,
  },
  valueAccent: {
    color: pdfColors.terracottaDark,
    fontFamily: pdfFonts.bold,
    fontWeight: "bold",
    fontSize: 12,
    marginTop: 6,
  },
  valuePositive: {
    color: pdfColors.greenDark,
    fontFamily: pdfFonts.bold,
    fontWeight: "bold",
    fontSize: 12,
    marginTop: 6,
  },
});
