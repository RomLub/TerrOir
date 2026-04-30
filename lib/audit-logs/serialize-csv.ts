// Sérialisation CSV des audit_logs pour le bouton "Exporter CSV"
// (page admin /audit-logs, T-080 Phase 2).
//
// Choix format documentés (validés Phase 2) :
//   - Séparateur ';'  : Excel FR ouvre nativement avec ce séparateur (',' = sép.
//                       décimal). LibreOffice / Sheets / Pandas auto-détectent.
//   - Encodage UTF-8 BOM (﻿ prepended) : sans BOM, Excel FR mange les
//                       accents.
//   - Line ending CRLF : RFC 4180 strict, Excel/LibreOffice/Pandas tolèrent
//                       LF mais CRLF est universel.
//   - Échappement RFC 4180 : si la valeur contient ';', '"', '\n' ou '\r',
//                       on enveloppe en "..." et on double les '"' internes.
//   - null → string vide.
//   - metadata JSONB → JSON.stringify single-line.
//   - created_at → ISO 8601 UTC tel quel (l'export est destiné à analyse
//                  programmatique, ISO universel > formatage local).
//   - is_producer → "true" / "false" littéral texte (cohérent UI badge "Prod"
//                   T-080 finitions).
//
// Avertissement de troncature : si options.truncated = true, on prepend une
// ligne "# AVERTISSEMENT: ..." en row 1 (single cell colonne A). L'admin
// voit le warning en haut de son fichier Excel/Sheets sans casser la
// structure colonnes (un parser pandas avec header=1 lira correctement).

const SEPARATOR = ";";
const LINE_ENDING = "\r\n";
const BOM = "﻿";

const COLUMNS = [
  "created_at",
  "event_type",
  "user_id",
  "ip_address",
  "user_agent",
  "metadata",
  "is_producer",
] as const;

export type AuditLogCsvRow = {
  created_at: string;
  event_type: string;
  user_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown>;
  is_producer: boolean;
};

const NEEDS_QUOTING_RE = /[";\r\n]/;

export function escapeCsvField(value: string): string {
  if (NEEDS_QUOTING_RE.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function serializeRow(row: AuditLogCsvRow): string {
  const fields: string[] = [
    row.created_at,
    row.event_type,
    row.user_id ?? "",
    row.ip_address ?? "",
    row.user_agent ?? "",
    JSON.stringify(row.metadata ?? {}),
    row.is_producer ? "true" : "false",
  ];
  return fields.map(escapeCsvField).join(SEPARATOR);
}

export function serializeAuditLogsToCsv(
  rows: AuditLogCsvRow[],
  options: { truncated?: boolean } = {},
): string {
  const lines: string[] = [];
  if (options.truncated) {
    // Ligne d'avertissement en row 1, single cell colonne A. Le `#` est
    // une convention "ligne de commentaire" reconnue par certains parsers
    // (pandas comment='#' optionnel), et visuellement claire pour Excel.
    lines.push(
      escapeCsvField(
        "# AVERTISSEMENT: Export tronqué à 10 000 lignes. Affinez vos filtres pour un export complet.",
      ),
    );
  }
  lines.push(COLUMNS.join(SEPARATOR));
  for (const row of rows) {
    lines.push(serializeRow(row));
  }
  return BOM + lines.join(LINE_ENDING) + LINE_ENDING;
}
