import { Font } from "@react-pdf/renderer";

let fontsRegistered = false;

export const pdfColors = {
  terracotta: "#A0522D",
  terracottaDark: "#804A20",
  terracottaSoft: "#F5E6DC",
  terracottaPale: "#FBF3EC",
  beige: "#F7F4EF",
  beigeLight: "#FFFDF8",
  green: "#2D6A4F",
  greenDark: "#1B4332",
  greenSoft: "#F1FAF3",
  ink: "#1A1A1A",
  inkSoft: "#243128",
  muted: "#6B7280",
  mutedWarm: "#66665D",
  border: "#E6E1D6",
  borderStrong: "#D8CEC5",
  white: "#FFFFFF",
} as const;

export const pdfSpacing = {
  pageX: 30,
  pageTop: 28,
  pageBottom: 70,
  sectionGap: 16,
  radius: 6,
  cardPadding: 10,
} as const;

export const pdfFonts = {
  body: "NotoSans",
  bold: "NotoSans",
  mono: "Courier",
} as const;

export function registerPdfFonts() {
  if (fontsRegistered) return;

  Font.register({
    family: pdfFonts.body,
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

  fontsRegistered = true;
}

export const pdfPageStyle = {
  paddingTop: pdfSpacing.pageTop,
  paddingRight: pdfSpacing.pageX,
  paddingBottom: pdfSpacing.pageBottom,
  paddingLeft: pdfSpacing.pageX,
  fontFamily: pdfFonts.body,
  fontSize: 9,
  color: pdfColors.ink,
  backgroundColor: pdfColors.beigeLight,
};

export const pdfSectionTitleStyle = {
  color: pdfColors.greenDark,
  fontFamily: pdfFonts.bold,
  fontWeight: "bold" as const,
  fontSize: 12,
  marginBottom: 8,
};

export const pdfEyebrowStyle = {
  color: pdfColors.terracotta,
  fontFamily: pdfFonts.bold,
  fontWeight: "bold" as const,
  fontSize: 7,
  textTransform: "uppercase" as const,
};

export const pdfTableShellStyle = {
  borderWidth: 1,
  borderColor: pdfColors.borderStrong,
  borderRadius: pdfSpacing.radius,
  backgroundColor: pdfColors.white,
};

export function formatPdfEuro(value: number): string {
  return `${formatPdfNumber(value, 2, { trimDecimals: false })} €`;
}

export function formatPdfQuantity(value: number): string {
  return formatPdfNumber(value, 3, { trimDecimals: true });
}

export function formatPdfDateTime(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  }).format(new Date(iso));
}

function formatPdfNumber(
  value: number,
  maximumFractionDigits: number,
  options: { trimDecimals: boolean },
): string {
  const sign = value < 0 ? "-" : "";
  const fixed = Math.abs(value).toFixed(maximumFractionDigits);
  const [integer = "0", decimals = ""] = fixed.split(".");
  const integerWithSpaces = integer.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const trimmedDecimals = options.trimDecimals
    ? decimals.replace(/0+$/, "")
    : decimals;

  return trimmedDecimals
    ? `${sign}${integerWithSpaces},${trimmedDecimals}`
    : `${sign}${integerWithSpaces}`;
}
