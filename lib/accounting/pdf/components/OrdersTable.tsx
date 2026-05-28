import { StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ProducerAccountingExportOrder } from "@/lib/accounting/producer-export-data";

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
      <Text style={styles.heading}>Détail des commandes</Text>
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
              <Text style={[styles.cell, { width: COLUMNS[3].width }]}>{order.status}</Text>
              <Text style={[styles.cellAmount, { width: COLUMNS[4].width }]}>
                {formatEuro(order.totalTtc)}
              </Text>
              <Text style={[styles.cellAmount, { width: COLUMNS[5].width }]}>
                {formatEuro(order.terroirCommission)}
              </Text>
              <Text style={[styles.cellAmountStrong, { width: COLUMNS[6].width }]}>
                {formatEuro(order.producerNet)}
              </Text>
            </View>
          ))
        )}
      </View>
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
    marginTop: 2,
  },
  heading: {
    color: "#1f3328",
    fontFamily: "Helvetica-Bold",
    fontSize: 12,
    marginBottom: 8,
  },
  table: {
    borderWidth: 1,
    borderColor: "#d8cec5",
    borderRadius: 5,
  },
  headerRow: {
    flexDirection: "row",
    backgroundColor: "#2d6a4f",
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  headerCell: {
    color: "#FFFFFF",
    fontFamily: "Helvetica-Bold",
    fontSize: 7,
    paddingVertical: 7,
    paddingHorizontal: 4,
    textTransform: "uppercase",
  },
  row: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#e7ded6",
    backgroundColor: "#FFFFFF",
  },
  rowAlt: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#e7ded6",
    backgroundColor: "#fbfaf8",
  },
  cell: {
    paddingVertical: 7,
    paddingHorizontal: 4,
    fontSize: 8,
    color: "#243128",
  },
  cellMono: {
    paddingVertical: 7,
    paddingHorizontal: 4,
    fontSize: 8,
    color: "#243128",
    fontFamily: "Courier",
  },
  cellAmount: {
    paddingVertical: 7,
    paddingHorizontal: 4,
    fontSize: 8,
    color: "#243128",
    textAlign: "right",
  },
  cellAmountStrong: {
    paddingVertical: 7,
    paddingHorizontal: 4,
    fontSize: 8,
    color: "#2d6a4f",
    fontFamily: "Helvetica-Bold",
    textAlign: "right",
  },
  emptyRow: {
    padding: 16,
  },
  emptyText: {
    color: "#6a6a62",
    fontSize: 9,
  },
});
