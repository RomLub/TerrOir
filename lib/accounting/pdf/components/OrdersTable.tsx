import { StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ProducerAccountingExportOrder } from "@/lib/accounting/producer-export-data";
import {
  formatPdfEuro,
  pdfColors,
  pdfFonts,
  pdfSectionTitleStyle,
  pdfTableShellStyle,
} from "@/lib/accounting/pdf/theme";

const COLUMNS = [
  { label: "Date", width: "13%" },
  { label: "Commande", width: "17%" },
  { label: "Client", width: "19%" },
  { label: "Statut", width: "12%" },
  { label: "TTC", width: "13%" },
  { label: "Commission", width: "13%" },
  { label: "Net", width: "13%" },
] as const;

export function OrdersTable({
  orders,
}: {
  orders: ProducerAccountingExportOrder[];
}) {
  return (
    <View style={styles.container}>
      <View style={styles.sectionTitleRow}>
        <Text style={styles.heading}>Détail des commandes</Text>
        <Text style={styles.count}>{orders.length} ligne(s)</Text>
      </View>
      <View style={styles.table}>
        <View style={styles.headerRow} wrap={false}>
          {COLUMNS.map((column) => (
            <Text key={column.label} style={[styles.headerCell, { width: column.width }]}>
              {column.label}
            </Text>
          ))}
        </View>

        {orders.length === 0 ? (
          <View style={styles.emptyRow}>
            <Text style={styles.emptyText}>
              Aucune commande validée sur cette période.
            </Text>
          </View>
        ) : (
          orders.map((order, index) => (
            <View
              key={order.id}
              style={index % 2 === 0 ? styles.row : styles.rowAlt}
              wrap={false}
            >
              <Text style={[styles.cell, { width: COLUMNS[0].width }]}>{order.date}</Text>
              <Text style={[styles.cellMono, { width: COLUMNS[1].width }]}>
                {order.orderNumber}
              </Text>
              <Text style={[styles.cell, { width: COLUMNS[2].width }]}>{order.client}</Text>
              <Text style={[styles.cellStatus, { width: COLUMNS[3].width }]}>
                {order.status}
              </Text>
              <Text style={[styles.cellAmount, { width: COLUMNS[4].width }]}>
                {formatPdfEuro(order.totalTtc)}
              </Text>
              <Text style={[styles.cellAmount, { width: COLUMNS[5].width }]}>
                {formatPdfEuro(order.terroirCommission)}
              </Text>
              <Text style={[styles.cellAmountStrong, { width: COLUMNS[6].width }]}>
                {formatPdfEuro(order.producerNet)}
              </Text>
            </View>
          ))
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 2,
  },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  heading: pdfSectionTitleStyle,
  count: {
    color: pdfColors.muted,
    fontSize: 8,
  },
  table: pdfTableShellStyle,
  headerRow: {
    flexDirection: "row",
    backgroundColor: pdfColors.terracotta,
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
  },
  headerCell: {
    color: pdfColors.white,
    fontFamily: pdfFonts.bold,
    fontWeight: "bold",
    fontSize: 7,
    paddingVertical: 7,
    paddingHorizontal: 4,
    textTransform: "uppercase",
  },
  row: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: pdfColors.border,
    backgroundColor: pdfColors.white,
  },
  rowAlt: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: pdfColors.border,
    backgroundColor: pdfColors.beige,
  },
  cell: {
    paddingVertical: 7,
    paddingHorizontal: 4,
    fontSize: 8,
    color: pdfColors.ink,
  },
  cellStatus: {
    paddingVertical: 7,
    paddingHorizontal: 4,
    fontSize: 8,
    color: pdfColors.inkSoft,
  },
  cellMono: {
    paddingVertical: 7,
    paddingHorizontal: 4,
    fontSize: 8,
    color: pdfColors.ink,
    fontFamily: pdfFonts.mono,
  },
  cellAmount: {
    paddingVertical: 7,
    paddingHorizontal: 4,
    fontSize: 8,
    color: pdfColors.ink,
    textAlign: "right",
  },
  cellAmountStrong: {
    paddingVertical: 7,
    paddingHorizontal: 4,
    fontSize: 8,
    color: pdfColors.greenDark,
    fontFamily: pdfFonts.bold,
    fontWeight: "bold",
    textAlign: "right",
  },
  emptyRow: {
    padding: 16,
  },
  emptyText: {
    color: pdfColors.muted,
    fontSize: 9,
  },
});
