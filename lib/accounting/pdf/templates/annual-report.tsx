import {
  Document,
  Font,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import type {
  ProducerAnnualReportData,
  ProducerAnnualReportMonth,
  ProducerAnnualReportProduct,
} from "@/lib/accounting/producer-annual-report";

Font.register({
  family: "NotoSans",
  fonts: [
    {
      src: `${process.cwd()}/public/fonts/NotoSans-Regular.ttf`,
      fontWeight: "normal",
    },
    {
      src: `${process.cwd()}/public/fonts/NotoSans-Bold.ttf`,
      fontWeight: "bold",
    },
  ],
});

export function AnnualReportDocument({
  data,
  logoSrc,
}: {
  data: ProducerAnnualReportData;
  logoSrc: string;
}) {
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
        <Header data={data} logoSrc={logoSrc} />
        <KeyFigures data={data} />
        <MonthlyEvolution months={data.monthly} />
        <TopProducts products={data.topProducts} />
        <Footer />
      </Page>
    </Document>
  );
}

function Header({
  data,
  logoSrc,
}: {
  data: ProducerAnnualReportData;
  logoSrc: string;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.brandRow}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- React-PDF Image ne supporte pas l'attribut alt HTML. */}
        <Image src={logoSrc} style={styles.logo} />
        <View style={styles.headerText}>
          <Text style={styles.eyebrow}>Bilan d&apos;activité producteur</Text>
          <Text style={styles.title}>Bilan annuel TerrOir</Text>
          <Text style={styles.subtitle}>
            {data.producer.exploitation} · Année {data.year}
          </Text>
        </View>
      </View>
      <Text style={styles.intro}>
        Une synthèse lisible de l&apos;activité réalisée via TerrOir sur
        l&apos;année, pensée pour suivre la dynamique commerciale de
        l&apos;exploitation.
      </Text>
    </View>
  );
}

function KeyFigures({ data }: { data: ProducerAnnualReportData }) {
  const bestMonthLabel = data.summary.bestMonth?.label ?? "Aucun";
  const bestMonthAmount = data.summary.bestMonth
    ? formatEuro(data.summary.bestMonth.totalTtc)
    : undefined;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Chiffres clés</Text>
      <View style={styles.cards}>
        <Figure label="Commandes" value={String(data.summary.ordersCount)} />
        <Figure label="Chiffre d'affaires TTC" value={formatEuro(data.summary.totalTtc)} />
        <Figure label="Commission TerrOir" value={formatEuro(data.summary.terroirCommission)} />
        <Figure label="Net producteur" value={formatEuro(data.summary.producerNet)} strong />
        <Figure label="Panier moyen" value={formatEuro(data.summary.averageBasket)} />
        <Figure label="Meilleur mois" value={bestMonthLabel} subValue={bestMonthAmount} />
        <Figure label="Clients uniques" value={String(data.summary.uniqueClients)} />
      </View>
    </View>
  );
}

function Figure({
  label,
  value,
  subValue,
  strong = false,
}: {
  label: string;
  value: string;
  subValue?: string;
  strong?: boolean;
}) {
  return (
    <View style={strong ? styles.figureStrong : styles.figure}>
      <Text style={strong ? styles.figureLabelStrong : styles.figureLabel}>{label}</Text>
      <Text style={strong ? styles.figureValueStrong : styles.figureValue}>{value}</Text>
      {subValue ? <Text style={styles.figureSubValue}>{subValue}</Text> : null}
    </View>
  );
}

function MonthlyEvolution({
  months,
}: {
  months: ProducerAnnualReportMonth[];
}) {
  const maxTotal = Math.max(...months.map((month) => month.totalTtc), 0);

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Évolution mensuelle</Text>
      <View style={styles.monthTable}>
        <View style={styles.monthHeader} wrap={false}>
          <Text style={[styles.monthHeadCell, styles.monthName]}>Mois</Text>
          <Text style={styles.monthHeadCell}>Commandes</Text>
          <Text style={styles.monthHeadCell}>CA TTC</Text>
          <Text style={styles.monthHeadCell}>Net producteur</Text>
        </View>
        {months.map((month) => (
          <View key={month.month} style={styles.monthRow} wrap={false}>
            <Text style={[styles.monthCell, styles.monthName]}>{month.label}</Text>
            <Text style={styles.monthCell}>{month.ordersCount}</Text>
            <View style={styles.monthAmountCell}>
              <Text style={styles.monthAmountText}>{formatEuro(month.totalTtc)}</Text>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    {
                      width:
                        maxTotal > 0
                          ? `${Math.max(4, (month.totalTtc / maxTotal) * 100)}%`
                          : "0%",
                    },
                  ]}
                />
              </View>
            </View>
            <Text style={styles.monthCellStrong}>{formatEuro(month.producerNet)}</Text>
          </View>
        ))}
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
    <View style={styles.section} break>
      <Text style={styles.sectionTitle}>Top produits</Text>
      {products.length === 0 ? (
        <Text style={styles.empty}>Aucun produit vendu sur cette année.</Text>
      ) : (
        <View style={styles.productList}>
          {products.map((product, index) => (
            <View key={product.productId} style={styles.productRow} wrap={false}>
              <Text style={styles.productRank}>#{index + 1}</Text>
              <Text style={styles.productName}>{product.name}</Text>
              <Text style={styles.productMetric}>{formatQuantity(product.quantity)}</Text>
              <Text style={styles.productMetric}>{product.ordersCount} commandes</Text>
              <Text style={styles.productTotal}>{formatEuro(product.totalTtc)}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function Footer() {
  return (
    <View style={styles.footer} fixed>
      <Text>
        Ce document est un bilan d&apos;activité non comptable généré par TerrOir.
      </Text>
      <Text
        style={styles.pageNumber}
        render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
      />
    </View>
  );
}

function formatEuro(value: number): string {
  return `${formatFrenchNumber(value, 2, { trimDecimals: false })} €`;
}

function formatQuantity(value: number): string {
  return formatFrenchNumber(value, 3, { trimDecimals: true });
}

function formatFrenchNumber(
  value: number,
  maximumFractionDigits: number,
  options: { trimDecimals: boolean },
): string {
  const sign = value < 0 ? "-" : "";
  const fixed = Math.abs(value).toFixed(maximumFractionDigits);
  const [integer = "0", decimals = ""] = fixed.split(".");
  const integerWithSpaces = integer.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const trimmedDecimals = options.trimDecimals ? decimals.replace(/0+$/, "") : decimals;
  return trimmedDecimals
    ? `${sign}${integerWithSpaces},${trimmedDecimals}`
    : `${sign}${integerWithSpaces}`;
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingRight: 30,
    paddingBottom: 58,
    paddingLeft: 30,
    fontFamily: "NotoSans",
    fontSize: 9,
    color: "#243128",
    backgroundColor: "#fffdf8",
  },
  header: {
    marginBottom: 18,
    borderRadius: 8,
    backgroundColor: "#2d6a4f",
    padding: 18,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  logo: {
    width: 104,
    height: 56,
    objectFit: "contain",
  },
  headerText: {
    textAlign: "right",
    maxWidth: 330,
  },
  eyebrow: {
    color: "#f5e6dc",
    fontSize: 8,
    textTransform: "uppercase",
    marginBottom: 5,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 24,
    fontFamily: "NotoSans",
    fontWeight: "bold",
  },
  subtitle: {
    color: "#f5e6dc",
    marginTop: 6,
    fontSize: 11,
  },
  intro: {
    color: "#fff7ef",
    marginTop: 14,
    lineHeight: 1.45,
    fontSize: 10,
  },
  section: {
    marginBottom: 18,
  },
  sectionTitle: {
    color: "#1f3328",
    fontFamily: "NotoSans",
    fontWeight: "bold",
    fontSize: 13,
    marginBottom: 8,
  },
  cards: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  figure: {
    width: "23.5%",
    minHeight: 55,
    borderWidth: 1,
    borderColor: "#e7ded6",
    borderRadius: 6,
    padding: 9,
    backgroundColor: "#FFFFFF",
  },
  figureStrong: {
    width: "23.5%",
    minHeight: 55,
    borderWidth: 1,
    borderColor: "#2d6a4f",
    borderRadius: 6,
    padding: 9,
    backgroundColor: "#edf6ef",
  },
  figureLabel: {
    color: "#6a6a62",
    fontSize: 7,
    textTransform: "uppercase",
  },
  figureLabelStrong: {
    color: "#2d6a4f",
    fontSize: 7,
    textTransform: "uppercase",
  },
  figureValue: {
    marginTop: 5,
    color: "#1f3328",
    fontFamily: "NotoSans",
    fontWeight: "bold",
    fontSize: 11,
  },
  figureValueStrong: {
    marginTop: 5,
    color: "#2d6a4f",
    fontFamily: "NotoSans",
    fontWeight: "bold",
    fontSize: 11,
  },
  figureSubValue: {
    marginTop: 2,
    color: "#6a6a62",
    fontSize: 8,
  },
  monthTable: {
    borderWidth: 1,
    borderColor: "#d8cec5",
    borderRadius: 6,
    backgroundColor: "#FFFFFF",
  },
  monthHeader: {
    flexDirection: "row",
    backgroundColor: "#8f4f2a",
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
  },
  monthHeadCell: {
    width: "22%",
    color: "#FFFFFF",
    fontFamily: "NotoSans",
    fontWeight: "bold",
    fontSize: 7,
    paddingVertical: 6,
    paddingHorizontal: 5,
    textTransform: "uppercase",
  },
  monthRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#eee3da",
  },
  monthName: {
    width: "24%",
  },
  monthCell: {
    width: "22%",
    paddingVertical: 6,
    paddingHorizontal: 5,
    fontSize: 8,
  },
  monthCellStrong: {
    width: "22%",
    paddingVertical: 6,
    paddingHorizontal: 5,
    fontSize: 8,
    color: "#2d6a4f",
    fontFamily: "NotoSans",
    fontWeight: "bold",
    textAlign: "right",
  },
  monthAmountCell: {
    width: "32%",
    paddingVertical: 5,
    paddingHorizontal: 5,
  },
  monthAmountText: {
    fontSize: 8,
    marginBottom: 3,
  },
  barTrack: {
    height: 4,
    backgroundColor: "#f1e8df",
    borderRadius: 2,
  },
  barFill: {
    height: 4,
    backgroundColor: "#2d6a4f",
    borderRadius: 2,
  },
  productList: {
    borderWidth: 1,
    borderColor: "#d8cec5",
    borderRadius: 6,
    backgroundColor: "#FFFFFF",
  },
  productRow: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "#eee3da",
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  productRank: {
    width: "8%",
    color: "#8f4f2a",
    fontFamily: "NotoSans",
    fontWeight: "bold",
  },
  productName: {
    width: "42%",
    fontFamily: "NotoSans",
    fontWeight: "bold",
  },
  productMetric: {
    width: "17%",
    color: "#6a6a62",
    textAlign: "right",
  },
  productTotal: {
    width: "16%",
    color: "#2d6a4f",
    fontFamily: "NotoSans",
    fontWeight: "bold",
    textAlign: "right",
  },
  empty: {
    borderWidth: 1,
    borderColor: "#d8cec5",
    borderRadius: 6,
    padding: 12,
    color: "#6a6a62",
    backgroundColor: "#FFFFFF",
  },
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
  pageNumber: {
    position: "absolute",
    right: 0,
    top: 8,
    color: "#2d6a4f",
    fontSize: 8,
    fontFamily: "NotoSans",
    fontWeight: "bold",
  },
});
