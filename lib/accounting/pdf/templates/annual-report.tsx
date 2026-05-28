import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type {
  ProducerAnnualReportData,
  ProducerAnnualReportMonth,
  ProducerAnnualReportProduct,
} from "@/lib/accounting/producer-annual-report";
import { buildAnnualReportSummaryText } from "@/lib/accounting/pdf/annual-summary";
import { PdfBrandHeader } from "@/lib/accounting/pdf/components/PdfBrandHeader";
import { PdfFooter } from "@/lib/accounting/pdf/components/PdfFooter";
import {
  formatPdfDateTime,
  formatPdfEuro,
  formatPdfQuantity,
  pdfColors,
  pdfEyebrowStyle,
  pdfFonts,
  pdfPageStyle,
  pdfSectionTitleStyle,
  pdfSpacing,
  pdfTableShellStyle,
  registerPdfFonts,
} from "@/lib/accounting/pdf/theme";

export function AnnualReportDocument({
  data,
  logoSrc,
}: {
  data: ProducerAnnualReportData;
  logoSrc: string;
}) {
  registerPdfFonts();

  return (
    <Document
      title={`Bilan annuel TerrOir - ${data.producer.exploitation} - ${data.year}`}
      author="TerrOir"
      creator="TerrOir"
      producer="TerrOir"
      subject="Bilan annuel d'activité producteur"
      language="fr-FR"
    >
      <Page size="A4" style={styles.page} wrap>
        <PdfBrandHeader
          logoSrc={logoSrc}
          eyebrow="Bilan d'activité producteur"
          title="Bilan annuel TerrOir"
          subtitle={`${data.producer.exploitation} · Année ${data.year}`}
          highContrastText
          intro="Une synthèse lisible de l'activité réalisée via TerrOir sur l'année, pensée pour suivre la dynamique commerciale de l'exploitation."
          info={[
            { label: "Producteur", value: data.producer.name },
            { label: "Exploitation", value: data.producer.exploitation },
            { label: "SIRET", value: data.producer.siret ?? "Non renseigné" },
            { label: "Généré le", value: formatPdfDateTime(data.generatedAt) },
            { label: "Période", value: data.period.label, wide: true },
          ]}
        />
        <AnnualSummary data={data} />
        <KeyFigures data={data} />
        <MonthlyEvolution
          months={data.monthly}
          bestMonth={data.summary.bestMonth}
        />
        <TopProducts products={data.topProducts} />
        <PdfFooter
          lines={[
            "Ce document est un bilan d'activité non comptable généré par TerrOir.",
            "Il complète le relevé comptable et ne remplace pas les obligations comptables légales du producteur.",
          ]}
        />
      </Page>
    </Document>
  );
}

function AnnualSummary({ data }: { data: ProducerAnnualReportData }) {
  const lines = buildAnnualReportSummaryText(data);

  return (
    <View style={styles.summaryBox} wrap={false}>
      <Text style={styles.summaryKicker}>Synthèse automatique</Text>
      {lines.map((line) => (
        <Text key={line} style={styles.summaryText}>
          {line}
        </Text>
      ))}
    </View>
  );
}

function KeyFigures({ data }: { data: ProducerAnnualReportData }) {
  const bestMonthLabel = data.summary.bestMonth?.label ?? "Aucun";
  const bestMonthAmount = data.summary.bestMonth
    ? formatPdfEuro(data.summary.bestMonth.totalTtc)
    : undefined;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Chiffres clés</Text>
      <View style={styles.heroCards} wrap={false}>
        <Figure
          label="CA annuel TTC"
          value={formatPdfEuro(data.summary.totalTtc)}
          tone="accent"
          large
        />
        <Figure
          label="Net producteur"
          value={formatPdfEuro(data.summary.producerNet)}
          tone="positive"
          large
        />
      </View>
      <View style={styles.cards}>
        <Figure label="Commandes" value={String(data.summary.ordersCount)} />
        <Figure
          label="Panier moyen"
          value={formatPdfEuro(data.summary.averageBasket)}
        />
        <Figure
          label="Commission TerrOir"
          value={formatPdfEuro(data.summary.terroirCommission)}
        />
        <Figure
          label="Clients uniques"
          value={String(data.summary.uniqueClients)}
        />
        <Figure
          label="Meilleur mois"
          value={bestMonthLabel}
          subValue={bestMonthAmount}
          tone="accent"
        />
      </View>
    </View>
  );
}

function Figure({
  label,
  value,
  subValue,
  tone = "neutral",
  large = false,
}: {
  label: string;
  value: string;
  subValue?: string;
  tone?: "neutral" | "accent" | "positive";
  large?: boolean;
}) {
  const baseStyle = large ? styles.figureLarge : styles.figure;
  const cardStyle =
    tone === "accent"
      ? [baseStyle, styles.figureAccent]
      : tone === "positive"
        ? [baseStyle, styles.figurePositive]
        : baseStyle;
  const valueStyle =
    tone === "positive"
      ? styles.figureValuePositive
      : tone === "accent"
        ? styles.figureValueAccent
        : styles.figureValue;

  return (
    <View style={cardStyle}>
      <Text style={styles.figureLabel}>{label}</Text>
      <Text style={large ? [valueStyle, styles.figureValueLarge] : valueStyle}>
        {value}
      </Text>
      {subValue ? <Text style={styles.figureSubValue}>{subValue}</Text> : null}
    </View>
  );
}

function MonthlyEvolution({
  months,
  bestMonth,
}: {
  months: ProducerAnnualReportMonth[];
  bestMonth: ProducerAnnualReportMonth | null;
}) {
  const maxTotal = Math.max(...months.map((month) => month.totalTtc), 0);

  return (
    <View style={styles.section} wrap={false}>
      <Text style={styles.sectionTitle}>Évolution mensuelle</Text>
      <MonthlyChart months={months} maxTotal={maxTotal} bestMonth={bestMonth} />
      <View style={styles.monthTable}>
        <View style={styles.monthHeader} wrap={false}>
          <Text style={[styles.monthHeadCell, styles.monthName]}>Mois</Text>
          <Text style={styles.monthHeadCell}>Commandes</Text>
          <Text style={styles.monthHeadCell}>CA TTC</Text>
          <Text style={styles.monthHeadCell}>Net producteur</Text>
        </View>
        {months.map((month) => {
          const isBestMonth = bestMonth?.month === month.month;
          return (
            <View
              key={month.month}
              style={isBestMonth ? styles.monthRowBest : styles.monthRow}
              wrap={false}
            >
              <Text
                style={
                  isBestMonth
                    ? [styles.monthCell, styles.monthName, styles.monthCellBest]
                    : [styles.monthCell, styles.monthName]
                }
              >
                {month.label}
              </Text>
              <Text style={styles.monthCell}>{month.ordersCount}</Text>
              <Text style={styles.monthCellAmount}>
                {formatPdfEuro(month.totalTtc)}
              </Text>
              <Text style={styles.monthCellStrong}>
                {formatPdfEuro(month.producerNet)}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function MonthlyChart({
  months,
  maxTotal,
  bestMonth,
}: {
  months: ProducerAnnualReportMonth[];
  maxTotal: number;
  bestMonth: ProducerAnnualReportMonth | null;
}) {
  return (
    <View style={styles.chart} wrap={false}>
      <View style={styles.chartAxis}>
        <Text style={styles.chartAxisLabel}>{formatPdfEuro(maxTotal)}</Text>
        <Text style={styles.chartAxisLabel}>0 €</Text>
      </View>
      <View style={styles.chartBars}>
        {months.map((month) => {
          const height =
            maxTotal > 0 ? Math.max(4, (month.totalTtc / maxTotal) * 52) : 0;
          const isBestMonth = bestMonth?.month === month.month;
          return (
            <View key={month.month} style={styles.chartMonth}>
              <View style={styles.chartTrack}>
                <View
                  style={
                    isBestMonth
                      ? [styles.chartBar, styles.chartBarBest, { height }]
                      : [styles.chartBar, { height }]
                  }
                />
              </View>
              <Text style={isBestMonth ? styles.chartLabelBest : styles.chartLabel}>
                {month.label.slice(0, 3)}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function TopProducts({
  products,
}: {
  products: ProducerAnnualReportProduct[];
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Top produits</Text>
      {products.length === 0 ? (
        <Text style={styles.empty}>Aucun produit vendu sur cette année.</Text>
      ) : (
        <View style={styles.productList}>
          <View style={styles.productHeader} wrap={false}>
            <Text style={[styles.productHeadCell, styles.productRank]}>Rang</Text>
            <Text style={[styles.productHeadCell, styles.productName]}>Produit</Text>
            <Text style={[styles.productHeadCell, styles.productMetric]}>
              Quantité
            </Text>
            <Text style={[styles.productHeadCell, styles.productMetric]}>
              Commandes
            </Text>
            <Text style={[styles.productHeadCell, styles.productTotal]}>CA TTC</Text>
          </View>
          {products.map((product, index) => (
            <View key={product.productId} style={styles.productRow} wrap={false}>
              <Text style={styles.productRank}>#{index + 1}</Text>
              <Text style={styles.productName}>{product.name}</Text>
              <Text style={styles.productMetric}>
                {formatPdfQuantity(product.quantity)}
              </Text>
              <Text style={styles.productMetric}>{product.ordersCount}</Text>
              <Text style={styles.productTotal}>
                {formatPdfEuro(product.totalTtc)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: pdfPageStyle,
  section: {
    marginBottom: pdfSpacing.sectionGap,
  },
  sectionTitle: pdfSectionTitleStyle,
  summaryBox: {
    marginBottom: pdfSpacing.sectionGap,
    borderWidth: 1,
    borderColor: pdfColors.border,
    borderRadius: pdfSpacing.radius,
    backgroundColor: pdfColors.white,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderLeftWidth: 4,
    borderLeftColor: pdfColors.terracotta,
  },
  summaryKicker: {
    ...pdfEyebrowStyle,
    marginBottom: 5,
  },
  summaryText: {
    color: pdfColors.ink,
    fontSize: 9,
    lineHeight: 1.45,
    marginTop: 2,
  },
  heroCards: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  cards: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  figure: {
    width: "18.75%",
    minHeight: 58,
    borderWidth: 1,
    borderColor: pdfColors.border,
    borderRadius: pdfSpacing.radius,
    padding: 9,
    backgroundColor: pdfColors.white,
  },
  figureLarge: {
    width: "49.25%",
    minHeight: 72,
    borderWidth: 1,
    borderColor: pdfColors.border,
    borderRadius: pdfSpacing.radius,
    padding: 11,
    backgroundColor: pdfColors.white,
  },
  figureAccent: {
    borderColor: pdfColors.terracotta,
    backgroundColor: pdfColors.terracottaPale,
  },
  figurePositive: {
    borderColor: pdfColors.green,
    backgroundColor: pdfColors.greenSoft,
  },
  figureLabel: {
    ...pdfEyebrowStyle,
    color: pdfColors.muted,
  },
  figureValue: {
    marginTop: 5,
    color: pdfColors.ink,
    fontFamily: pdfFonts.displayBold,
    fontSize: 10,
  },
  figureValueAccent: {
    marginTop: 5,
    color: pdfColors.terracottaDark,
    fontFamily: pdfFonts.displayBold,
    fontSize: 10,
  },
  figureValuePositive: {
    marginTop: 5,
    color: pdfColors.greenDark,
    fontFamily: pdfFonts.displayBold,
    fontSize: 10,
  },
  figureValueLarge: {
    fontSize: 18,
    marginTop: 7,
  },
  figureSubValue: {
    marginTop: 2,
    color: pdfColors.muted,
    fontSize: 8,
  },
  chart: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: pdfColors.border,
    borderRadius: pdfSpacing.radius,
    backgroundColor: pdfColors.white,
    paddingVertical: 9,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  chartAxis: {
    width: 48,
    height: 76,
    justifyContent: "space-between",
    paddingRight: 6,
  },
  chartAxisLabel: {
    color: pdfColors.muted,
    fontSize: 6,
    textAlign: "right",
  },
  chartBars: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    flexGrow: 1,
    height: 76,
    borderLeftWidth: 1,
    borderLeftColor: pdfColors.border,
    borderBottomWidth: 1,
    borderBottomColor: pdfColors.border,
    paddingLeft: 8,
    paddingRight: 2,
  },
  chartMonth: {
    width: 30,
    alignItems: "center",
  },
  chartTrack: {
    height: 56,
    width: 12,
    justifyContent: "flex-end",
    backgroundColor: pdfColors.beige,
    borderRadius: 3,
  },
  chartBar: {
    width: 12,
    backgroundColor: pdfColors.green,
    borderRadius: 3,
  },
  chartBarBest: {
    backgroundColor: pdfColors.terracotta,
  },
  chartLabel: {
    marginTop: 5,
    color: pdfColors.muted,
    fontSize: 6,
  },
  chartLabelBest: {
    marginTop: 5,
    color: pdfColors.terracottaDark,
    fontSize: 6,
    fontFamily: pdfFonts.bold,
    fontWeight: "bold",
  },
  monthTable: pdfTableShellStyle,
  monthHeader: {
    flexDirection: "row",
    backgroundColor: pdfColors.terracotta,
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
  },
  monthHeadCell: {
    width: "22%",
    color: pdfColors.white,
    fontFamily: pdfFonts.bold,
    fontWeight: "bold",
    fontSize: 7,
    paddingVertical: 6,
    paddingHorizontal: 5,
    textTransform: "uppercase",
  },
  monthRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: pdfColors.border,
    backgroundColor: pdfColors.white,
  },
  monthRowBest: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: pdfColors.border,
    backgroundColor: pdfColors.terracottaPale,
  },
  monthName: {
    width: "24%",
  },
  monthCell: {
    width: "22%",
    paddingVertical: 6,
    paddingHorizontal: 5,
    fontSize: 8,
    color: pdfColors.ink,
  },
  monthCellBest: {
    color: pdfColors.terracottaDark,
    fontFamily: pdfFonts.bold,
    fontWeight: "bold",
  },
  monthCellAmount: {
    width: "32%",
    paddingVertical: 6,
    paddingHorizontal: 5,
    fontSize: 8,
    color: pdfColors.ink,
    textAlign: "right",
  },
  monthCellStrong: {
    width: "22%",
    paddingVertical: 6,
    paddingHorizontal: 5,
    fontSize: 8,
    color: pdfColors.greenDark,
    fontFamily: pdfFonts.bold,
    fontWeight: "bold",
    textAlign: "right",
  },
  productList: pdfTableShellStyle,
  productHeader: {
    flexDirection: "row",
    backgroundColor: pdfColors.terracotta,
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
  },
  productHeadCell: {
    color: pdfColors.white,
    fontFamily: pdfFonts.bold,
    fontWeight: "bold",
    fontSize: 7,
    paddingVertical: 6,
    paddingHorizontal: 6,
    textTransform: "uppercase",
  },
  productRow: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: pdfColors.border,
    paddingVertical: 7,
    paddingHorizontal: 6,
    backgroundColor: pdfColors.white,
  },
  productRank: {
    width: "9%",
    color: pdfColors.terracottaDark,
    fontFamily: pdfFonts.bold,
    fontWeight: "bold",
  },
  productName: {
    width: "41%",
    color: pdfColors.ink,
    fontFamily: pdfFonts.bold,
    fontWeight: "bold",
  },
  productMetric: {
    width: "17%",
    color: pdfColors.muted,
    textAlign: "right",
  },
  productTotal: {
    width: "16%",
    color: pdfColors.greenDark,
    fontFamily: pdfFonts.bold,
    fontWeight: "bold",
    textAlign: "right",
  },
  empty: {
    borderWidth: 1,
    borderColor: pdfColors.borderStrong,
    borderRadius: pdfSpacing.radius,
    padding: 12,
    color: pdfColors.muted,
    backgroundColor: pdfColors.white,
  },
});
