import { StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ProducerAccountingSummary } from "@/lib/accounting/producer-export-data";

export function SummaryCards({
  summary,
}: {
  summary: ProducerAccountingSummary;
}) {
  return (
    <View style={styles.container}>
      <Card label="Commandes" value={String(summary.ordersCount)} />
      <Card label="Chiffre d'affaires TTC" value={formatEuro(summary.totalTtc)} />
      <Card label="Commission TerrOir" value={formatEuro(summary.terroirCommission)} />
      <Card label="Net producteur" value={formatEuro(summary.producerNet)} strong />
    </View>
  );
}

function Card({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <View style={strong ? styles.cardStrong : styles.card}>
      <Text style={strong ? styles.labelStrong : styles.label}>{label}</Text>
      <Text style={strong ? styles.valueStrong : styles.value}>{value}</Text>
    </View>
  );
}

function formatEuro(value: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 18,
  },
  card: {
    flexGrow: 1,
    flexBasis: 0,
    borderWidth: 1,
    borderColor: "#e7ded6",
    borderRadius: 6,
    padding: 10,
    backgroundColor: "#fbfaf8",
  },
  cardStrong: {
    flexGrow: 1,
    flexBasis: 0,
    borderWidth: 1,
    borderColor: "#2d6a4f",
    borderRadius: 6,
    padding: 10,
    backgroundColor: "#f1f7f3",
  },
  label: {
    color: "#6a6a62",
    fontSize: 7,
    textTransform: "uppercase",
  },
  labelStrong: {
    color: "#2d6a4f",
    fontSize: 7,
    textTransform: "uppercase",
  },
  value: {
    color: "#1f3328",
    fontFamily: "Helvetica-Bold",
    fontSize: 13,
    marginTop: 6,
  },
  valueStrong: {
    color: "#2d6a4f",
    fontFamily: "Helvetica-Bold",
    fontSize: 13,
    marginTop: 6,
  },
});
