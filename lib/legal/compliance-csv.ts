import type { UserComplianceRow } from "./compliance";

// CSV pour l'export admin /admin/legal-compliance. Mêmes conventions que
// lib/audit-logs/serialize-csv.ts (UTF-8 BOM, séparateur ';', CRLF, RFC
// 4180 escape, pas de virgule comme séparateur). Cohérent Excel FR + Sheets.
//
// Audience : Romain pré-launch transmettra ce CSV à un avocat ou audit
// manuel. Les colonnes sont alignées 1:1 sur la table affichée dans
// l'UI admin pour éviter toute surprise interprétative.

const SEPARATOR = ";";
const LINE_ENDING = "\r\n";
const BOM = "﻿";

const COLUMNS = [
  "user_id",
  "email",
  "prenom",
  "nom",
  "created_at",
  "cgu_status",
  "cgu_accepted_at",
  "cgu_version",
] as const;

const NEEDS_QUOTING_RE = /[";\r\n]/;

export function escapeCsvField(value: string): string {
  if (NEEDS_QUOTING_RE.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function serializeRow(row: UserComplianceRow): string {
  const fields: string[] = [
    row.id,
    row.email,
    row.prenom ?? "",
    row.nom ?? "",
    row.createdAt,
    row.status,
    row.acceptedAt ?? "",
    row.acceptedVersion ?? "",
  ];
  return fields.map(escapeCsvField).join(SEPARATOR);
}

export function serializeComplianceUsersToCsv(
  rows: UserComplianceRow[],
): string {
  const lines: string[] = [COLUMNS.join(SEPARATOR)];
  for (const row of rows) {
    lines.push(serializeRow(row));
  }
  return BOM + lines.join(LINE_ENDING) + LINE_ENDING;
}
