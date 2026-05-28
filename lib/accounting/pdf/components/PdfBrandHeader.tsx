import { Image, StyleSheet, Text, View } from "@react-pdf/renderer";
import {
  pdfColors,
  pdfEyebrowStyle,
  pdfFonts,
  pdfSpacing,
} from "@/lib/accounting/pdf/theme";

type HeaderInfo = {
  label: string;
  value: string;
  wide?: boolean;
};

export function PdfBrandHeader({
  logoSrc,
  eyebrow,
  title,
  subtitle,
  intro,
  info,
  highContrastText = false,
}: {
  logoSrc: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  intro?: string;
  info?: HeaderInfo[];
  highContrastText?: boolean;
}) {
  return (
    <View style={styles.container}>
      <View style={styles.brandBand}>
        <View style={styles.logoPanel}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- React-PDF Image ne supporte pas l'attribut alt HTML. */}
          <Image src={logoSrc} style={styles.logo} />
        </View>
        <View style={styles.titleBlock}>
          <Text
            style={highContrastText ? styles.eyebrowHighContrast : styles.eyebrow}
          >
            {eyebrow}
          </Text>
          <Text style={styles.title}>{title}</Text>
          <Text
            style={highContrastText ? styles.subtitleHighContrast : styles.subtitle}
          >
            {subtitle}
          </Text>
        </View>
      </View>

      {intro ? (
        <View style={styles.introBox}>
          <Text style={styles.intro}>{intro}</Text>
        </View>
      ) : null}

      {info?.length ? (
        <View style={styles.infoGrid}>
          {info.map((item) => (
            <Info key={item.label} {...item} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Info({ label, value, wide = false }: HeaderInfo) {
  return (
    <View style={wide ? styles.infoWide : styles.info}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: pdfSpacing.sectionGap,
  },
  brandBand: {
    backgroundColor: pdfColors.terracotta,
    borderRadius: pdfSpacing.radius,
    padding: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  logoPanel: {
    width: 122,
    height: 54,
    paddingHorizontal: 2,
    paddingVertical: 4,
    justifyContent: "center",
  },
  logo: {
    width: 118,
    height: 46,
    objectFit: "contain",
  },
  titleBlock: {
    textAlign: "right",
    maxWidth: 345,
  },
  eyebrow: {
    ...pdfEyebrowStyle,
    color: pdfColors.terracottaSoft,
    marginBottom: 5,
  },
  eyebrowHighContrast: {
    ...pdfEyebrowStyle,
    color: pdfColors.white,
    marginBottom: 5,
  },
  title: {
    color: pdfColors.white,
    fontSize: 22,
    fontFamily: pdfFonts.displayBold,
  },
  subtitle: {
    color: pdfColors.terracottaSoft,
    marginTop: 5,
    fontSize: 9,
  },
  subtitleHighContrast: {
    color: pdfColors.white,
    marginTop: 5,
    fontSize: 9,
  },
  introBox: {
    marginTop: 9,
    borderWidth: 1,
    borderColor: pdfColors.border,
    borderRadius: pdfSpacing.radius,
    backgroundColor: pdfColors.terracottaPale,
    paddingVertical: 9,
    paddingHorizontal: 11,
  },
  intro: {
    color: pdfColors.inkSoft,
    lineHeight: 1.45,
    fontSize: 9,
  },
  infoGrid: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: pdfColors.border,
    borderRadius: pdfSpacing.radius,
    padding: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    backgroundColor: pdfColors.white,
  },
  info: {
    width: "32%",
  },
  infoWide: {
    width: "66%",
  },
  infoLabel: {
    ...pdfEyebrowStyle,
    color: pdfColors.muted,
  },
  infoValue: {
    marginTop: 3,
    color: pdfColors.ink,
    fontSize: 10,
    fontFamily: pdfFonts.bold,
    fontWeight: "bold",
  },
});
