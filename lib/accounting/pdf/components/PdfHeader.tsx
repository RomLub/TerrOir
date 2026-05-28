import { Image, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ProducerAccountingExportData } from "@/lib/accounting/producer-export-data";

export function PdfHeader({
  data,
  logoSrc,
}: {
  data: ProducerAccountingExportData;
  logoSrc: string;
}) {
  return (
    <View style={styles.container}>
      <View style={styles.brandBand}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- React-PDF Image ne supporte pas l'attribut alt HTML. */}
        <Image src={logoSrc} style={styles.logo} />
        <View style={styles.titleBlock}>
          <Text style={styles.title}>Relevé d&apos;activité TerrOir</Text>
          <Text style={styles.subtitle}>Document comptable producteur</Text>
        </View>
      </View>

      <View style={styles.infoGrid}>
        <Info label="Producteur" value={data.producer.name} />
        <Info label="Exploitation" value={data.producer.exploitation} />
        <Info label="SIRET" value={data.producer.siret ?? "Non renseigné"} />
        <Info label="Date de génération" value={formatDateTime(data.generatedAt)} />
        <Info label="Période" value={data.period.label} wide />
      </View>
    </View>
  );
}

function Info({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <View style={wide ? styles.infoWide : styles.info}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  }).format(new Date(iso));
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 18,
  },
  brandBand: {
    backgroundColor: "#2d6a4f",
    borderRadius: 6,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  logo: {
    width: 108,
    height: 58,
    objectFit: "contain",
  },
  titleBlock: {
    textAlign: "right",
  },
  title: {
    color: "#FFFFFF",
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
  },
  subtitle: {
    color: "#f5e6dc",
    marginTop: 5,
    fontSize: 9,
    textTransform: "uppercase",
  },
  infoGrid: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: "#e7ded6",
    borderRadius: 6,
    padding: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  info: {
    width: "32%",
  },
  infoWide: {
    width: "66%",
  },
  infoLabel: {
    color: "#6a6a62",
    fontSize: 7,
    textTransform: "uppercase",
  },
  infoValue: {
    marginTop: 3,
    color: "#1f3328",
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
  },
});
