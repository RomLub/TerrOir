// Sérialisation CSV pour les exports comptabilité (consumer + producer).
//
// Spec format (T-232 export comptable) :
//   - Séparateur ',' (virgule)
//   - Encodage UTF-8 BOM (Excel FR mange les accents sans BOM)
//   - Line ending CRLF (RFC 4180 strict, universel)
//   - Échappement RFC 4180 : si la valeur contient ',', '"', '\n' ou '\r',
//     on enveloppe en "..." et on double les '"' internes.
//   - Header 1ère ligne explicite.
//
// NB : différent de lib/audit-logs/serialize-csv.ts (audit logs admin) qui
// utilise ';' pour Excel FR. Le séparateur ',' standardise l'export
// comptabilité avec les outils tiers (Pandas, Sage, comptables externes).

const SEPARATOR = ",";
const LINE_ENDING = "\r\n";
const BOM = "﻿";

const NEEDS_QUOTING_RE = /[",\r\n]/;

export function escapeCsvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (NEEDS_QUOTING_RE.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function serializeRowsToCsv<T extends Record<string, unknown>>(
  rows: T[],
  columns: { key: keyof T & string; header: string }[],
): string {
  const lines: string[] = [];
  lines.push(columns.map((c) => escapeCsvField(c.header)).join(SEPARATOR));
  for (const row of rows) {
    lines.push(
      columns
        .map((c) => escapeCsvField(row[c.key] as string | number | null))
        .join(SEPARATOR),
    );
  }
  return BOM + lines.join(LINE_ENDING) + LINE_ENDING;
}

// Masquage email pour export comptable producer (vue producteur sur ses
// commandes). Spec : "j***@d***.fr" — on garde le 1er char de la part
// locale et la 1ère lettre + TLD du domaine. Plus agressif que maskEmail()
// applicatif (lib/rgpd/mask-email.ts) car le producteur n'a pas besoin
// d'identifier le consumer (juste un repère pour réconciliation), et
// l'export CSV peut sortir du périmètre TerrOir (transmission comptable).
export function maskEmailForExport(email: string | null | undefined): string {
  if (!email) return "";
  const atIdx = email.indexOf("@");
  if (atIdx < 0) return "***";
  const local = email.slice(0, atIdx);
  const domain = email.slice(atIdx + 1);
  if (!local || !domain) return "***";
  const localHead = local[0] ?? "*";
  // Domain : 1ère lettre + extraction TLD (.fr, .com, etc.)
  const lastDotIdx = domain.lastIndexOf(".");
  if (lastDotIdx < 0) return `${localHead}***@${domain[0]}***`;
  const domainHead = domain[0] ?? "*";
  const tld = domain.slice(lastDotIdx);
  return `${localHead}***@${domainHead}***${tld}`;
}
