#!/usr/bin/env tsx
/* eslint-disable no-console */

// =============================================================================
// scripts/codegen-enums.ts (T-220)
// =============================================================================
// Génère lib/types/generated/enums.ts depuis supabase/migrations/*.sql.
// Single source of truth = SQL. Le code TS qui hardcode des valeurs d'enum
// (Zod, UI radio, helpers) doit importer depuis le fichier généré pour
// éviter toute dérive silencieuse.
//
// Patterns extraits :
//   1. Inline column CHECK (CREATE TABLE / ADD COLUMN) :
//        col text check (col in ('a', 'b'))
//   2. Named ADD CONSTRAINT :
//        alter table public.x add constraint x_y_check check (col in (...))
//   3. Array subset CHECK (text[] columns) :
//        col text[] check (col <@ array['a', 'b']::text[])
//   4. Nullable IN avec préfixe `is null or` :
//        check (col is null or col in ('a', 'b'))
//
// Stratégie pour les redéfinitions (DROP + ADD CONSTRAINT) : on parse les
// migrations dans l'ordre chronologique du nom de fichier (timestamp prefix).
// La DERNIÈRE définition pour un (table, column) gagne. Les migrations qui
// DROP COLUMN suppriment l'entry — fix le faux-positif `users.role` après
// le rename `role → roles`.
//
// Limitations connues V1 :
// - les CHECK pluri-colonnes ne sont pas extraits (ex: composite). Les
//   CHECK bool de longueur / range numérique ne sont pas non plus extraits.
// - les enums Postgres natifs (`CREATE TYPE x AS ENUM (...)`) sont supportés
//   mais aucun n'est utilisé dans TerrOir aujourd'hui (toujours CHECK).
//
// Output : `lib/types/generated/enums.ts` (commit-tracked).
//
// Run:
//   pnpm codegen:enums              # write
//   pnpm codegen:enums --dry-run    # print to stdout
//   pnpm codegen:enums --check      # CI guard (exit 1 si fichier non synchronisé)

import * as fs from "node:fs";
import * as path from "node:path";

const MIGRATIONS_DIR = path.resolve(__dirname, "../supabase/migrations");
const OUTPUT_FILE = path.resolve(__dirname, "../lib/types/generated/enums.ts");

type EnumKey = string; // "table.column"
type EnumDef = {
  table: string;
  column: string;
  values: string[];
  source: "in" | "subset_array" | "create_type";
  firstSeen: string;
  lastSeen: string;
};

// --- Helpers parser ---------------------------------------------------------

// Strip block comments `/* ... */` puis line comments `--`. Préserve les
// strings simples-quotées pour ne pas amputer un `'foo--bar'` en valeur.
function stripComments(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const c2 = sql[i + 1];
    if (c === "'") {
      out += c;
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          out += "''";
          i += 2;
          continue;
        }
        out += sql[i];
        if (sql[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === "/" && c2 === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === "-" && c2 === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ");
}

function extractStringLiterals(valuesExpr: string): string[] {
  const out: string[] = [];
  const re = /'([^']*)'(?:::\w+(?:\[\])?)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(valuesExpr))) {
    out.push(m[1]);
  }
  return out;
}

// Trouve l'index de fermeture de la paren ouverte à `start` (inclus).
// Retourne -1 si non trouvée. Tient compte des strings quotées simples.
function findMatchingParen(s: string, start: number): number {
  if (s[start] !== "(") return -1;
  let depth = 0;
  let i = start;
  while (i < s.length) {
    const c = s[i];
    if (c === "'") {
      i++;
      while (i < s.length) {
        if (s[i] === "'" && s[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (s[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

// --- Extracteurs principaux -------------------------------------------------

// Scan du body d'un CHECK (déjà unwrapped des parens) pour trouver tous
// les enum patterns. Plusieurs patterns coexistent (ex: nullable: `col is
// null or col in (...)`) — on garde tous, mais à l'upsert on prend la
// définition la plus complète (ie. nombre de valeurs max).
type EnumPattern = {
  column: string;
  values: string[];
  source: "in" | "subset_array";
};

function scanCheckBody(body: string): EnumPattern[] {
  const found: EnumPattern[] = [];

  // (a) `col in ('a', 'b', ...)` — paren after IN
  const inRe = /(\w+)\s+in\s*\(\s*((?:\s*'[^']*'(?:::\w+(?:\[\])?)?\s*,?\s*)+)\)/gi;
  for (let m: RegExpExecArray | null; (m = inRe.exec(body)) !== null; ) {
    const values = extractStringLiterals(m[2]);
    if (values.length > 0) {
      found.push({ column: m[1], values, source: "in" });
    }
  }

  // (b) `col = any (array['a', 'b']::text[])`
  const anyRe =
    /(\w+)\s*=\s*any\s*\(\s*array\s*\[\s*((?:\s*'[^']*'(?:::\w+(?:\[\])?)?\s*,?\s*)+)\]\s*(?:::\w+(?:\[\])?)?\s*\)/gi;
  for (let m: RegExpExecArray | null; (m = anyRe.exec(body)) !== null; ) {
    const values = extractStringLiterals(m[2]);
    if (values.length > 0) {
      found.push({ column: m[1], values, source: "in" });
    }
  }

  // (c) `col <@ array['a', 'b']::text[]`
  const subsetRe =
    /(\w+)\s*<@\s*array\s*\[\s*((?:\s*'[^']*'(?:::\w+(?:\[\])?)?\s*,?\s*)+)\]\s*(?:::\w+(?:\[\])?)?/gi;
  for (let m: RegExpExecArray | null; (m = subsetRe.exec(body)) !== null; ) {
    const values = extractStringLiterals(m[2]);
    if (values.length > 0) {
      found.push({ column: m[1], values, source: "subset_array" });
    }
  }

  return found;
}

function extractFromMigration(
  rawSql: string,
  filename: string,
  acc: Map<EnumKey, EnumDef>,
): void {
  const sql = normalize(stripComments(rawSql.toLowerCase()));

  // 1. CREATE TYPE ... AS ENUM (...) — Postgres native enums.
  const createTypeRe =
    /create\s+type\s+(?:public\.)?(\w+)\s+as\s+enum\s*\(([^)]+)\)/g;
  for (
    let m: RegExpExecArray | null;
    (m = createTypeRe.exec(sql)) !== null;
  ) {
    const name = m[1];
    const values = extractStringLiterals(m[2]);
    if (values.length === 0) continue;
    upsertEnum(
      acc,
      "_type",
      name,
      values,
      "create_type",
      filename,
    );
  }

  // 2. DROP COLUMN — nettoyage des entries stale (ex: users.role → roles).
  const dropColumnRe =
    /alter\s+table\s+(?:public\.)?(\w+)[^;]*?\bdrop\s+column\s+(?:if\s+exists\s+)?(\w+)/g;
  for (
    let m: RegExpExecArray | null;
    (m = dropColumnRe.exec(sql)) !== null;
  ) {
    const key = `${m[1]}.${m[2]}`;
    if (acc.has(key)) acc.delete(key);
  }

  // 3. CREATE TABLE blocks — récupère le body (parens balancées) et scanne.
  const createTableHeaderRe =
    /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)\s*\(/g;
  for (
    let m: RegExpExecArray | null;
    (m = createTableHeaderRe.exec(sql)) !== null;
  ) {
    const table = m[1];
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = findMatchingParen(sql, openIdx);
    if (closeIdx === -1) continue;
    const body = sql.slice(openIdx + 1, closeIdx);
    extractColumnDefsAndChecks(body, table, filename, acc);
  }

  // 4. ALTER TABLE blocks — capture full body up to terminating `;`.
  //    Beware of DO $$ blocks etc. ; on ne traite que les ALTER simples.
  const alterTableRe =
    /alter\s+table\s+(?:public\.)?(\w+)\s+([^;]+);/g;
  for (
    let m: RegExpExecArray | null;
    (m = alterTableRe.exec(sql)) !== null;
  ) {
    const table = m[1];
    const body = m[2];
    // ADD COLUMN avec inline CHECK
    extractAlterAddColumns(body, table, filename, acc);
    // ADD CONSTRAINT
    extractAlterAddConstraints(body, table, filename, acc);
  }
}

function extractColumnDefsAndChecks(
  tableBody: string,
  table: string,
  filename: string,
  acc: Map<EnumKey, EnumDef>,
): void {
  // Pour chaque "col type ... check (...)", on capture le body du CHECK et
  // le scanne. La balanced-paren walker garantit qu'on ne tronque pas un
  // body comme `check (col is null or col in ('a', 'b'))`.
  const re =
    /(\w+)\s+(?:text|varchar|character\s+varying)(?:\(\d+\))?(?:\[\])?\s+(?:[^,()]*?\s+)?check\s*\(/g;
  for (
    let m: RegExpExecArray | null;
    (m = re.exec(tableBody)) !== null;
  ) {
    const colName = m[1];
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = findMatchingParen(tableBody, openIdx);
    if (closeIdx === -1) continue;
    const checkBody = tableBody.slice(openIdx + 1, closeIdx);
    for (const p of scanCheckBody(checkBody)) {
      if (p.column !== colName) continue;
      upsertEnum(acc, table, p.column, p.values, p.source, filename);
    }
  }
}

function extractAlterAddColumns(
  body: string,
  table: string,
  filename: string,
  acc: Map<EnumKey, EnumDef>,
): void {
  // `add column [if not exists] col text[] [...] check (...)` à l'intérieur
  // d'un ALTER TABLE. Plusieurs ADD COLUMN peuvent être chaînés (séparés par
  // virgule) — on les capture tous via boucle.
  const re =
    /add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)\s+(?:text|varchar|character\s+varying)(?:\(\d+\))?(?:\[\])?\s+(?:[^,()]*?\s+)?check\s*\(/g;
  for (let m: RegExpExecArray | null; (m = re.exec(body)) !== null; ) {
    const colName = m[1];
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = findMatchingParen(body, openIdx);
    if (closeIdx === -1) continue;
    const checkBody = body.slice(openIdx + 1, closeIdx);
    for (const p of scanCheckBody(checkBody)) {
      if (p.column !== colName) continue;
      upsertEnum(acc, table, p.column, p.values, p.source, filename);
    }
  }
}

function extractAlterAddConstraints(
  body: string,
  table: string,
  filename: string,
  acc: Map<EnumKey, EnumDef>,
): void {
  const re = /add\s+constraint\s+\w+\s+check\s*\(/g;
  for (let m: RegExpExecArray | null; (m = re.exec(body)) !== null; ) {
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = findMatchingParen(body, openIdx);
    if (closeIdx === -1) continue;
    const checkBody = body.slice(openIdx + 1, closeIdx);
    const patterns = scanCheckBody(checkBody);
    if (patterns.length === 0) continue;
    // Si plusieurs patterns (ex: nullable `is null or in`), on prend celui
    // avec le max de valeurs (= la liste réelle). Les autres sont
    // syntaxiquement valides mais sémantiquement subsumés.
    const best = patterns.reduce((a, b) =>
      b.values.length > a.values.length ? b : a,
    );
    upsertEnum(acc, table, best.column, best.values, best.source, filename);
  }
}

function upsertEnum(
  acc: Map<EnumKey, EnumDef>,
  table: string,
  column: string,
  values: string[],
  source: EnumDef["source"],
  filename: string,
): void {
  const key = `${table}.${column}`;
  const existing = acc.get(key);
  if (!existing) {
    acc.set(key, {
      table,
      column,
      values,
      source,
      firstSeen: filename,
      lastSeen: filename,
    });
    return;
  }
  acc.set(key, {
    ...existing,
    values,
    source,
    lastSeen: filename,
  });
}

// --- Generation TS ----------------------------------------------------------

function pascalCase(...parts: string[]): string {
  return parts
    .flatMap((p) => p.split(/[_\s]+/))
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .join("");
}

function constName(table: string, column: string): string {
  if (table === "_type") return `${column.toUpperCase()}_VALUES`;
  return `${table.toUpperCase()}_${column.toUpperCase()}_VALUES`;
}

function typeName(table: string, column: string): string {
  if (table === "_type") return pascalCase(column);
  return pascalCase(table, column);
}

function generateOutput(enums: EnumDef[]): string {
  const sorted = [...enums].sort((a, b) =>
    `${a.table}.${a.column}`.localeCompare(`${b.table}.${b.column}`),
  );
  const lines: string[] = [
    "// AUTO-GENERATED — DO NOT EDIT MANUALLY",
    "// Run: pnpm codegen:enums",
    "// Source: supabase/migrations/*.sql (CHECK constraints)",
    "//",
    "// Single source of truth pour les enums applicatifs : valeurs extraites",
    "// directement des migrations SQL. Le code TS qui hardcode ces valeurs",
    "// (Zod, UI radio, helpers) doit importer ici pour éviter la dérive",
    "// TS↔SQL silencieuse. Cf. T-220.",
    "",
  ];
  for (const e of sorted) {
    const cName = constName(e.table, e.column);
    const tName = typeName(e.table, e.column);
    const values = e.values.map((v) => `"${v}"`).join(", ");
    const label =
      e.table === "_type"
        ? `enum ${e.column}`
        : `${e.table}.${e.column}`;
    lines.push(
      `// ${label} (source: ${e.source}, last migration: ${e.lastSeen})`,
    );
    lines.push(`export const ${cName} = [${values}] as const;`);
    lines.push(`export type ${tName} = (typeof ${cName})[number];`);
    lines.push("");
  }
  return lines.join("\n");
}

// --- Main -------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  const isCheck = args.includes("--check");
  const isDryRun = args.includes("--dry-run") || isCheck;

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const acc = new Map<EnumKey, EnumDef>();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
    extractFromMigration(sql, file, acc);
  }

  const enums = [...acc.values()];
  const output = generateOutput(enums);

  if (isDryRun) {
    if (isCheck) {
      const current = fs.existsSync(OUTPUT_FILE)
        ? fs.readFileSync(OUTPUT_FILE, "utf-8")
        : "";
      if (current.trim() !== output.trim()) {
        console.error(
          "[codegen:enums] OUT_OF_SYNC — lib/types/generated/enums.ts ne reflète pas l'état des migrations. Lance `pnpm codegen:enums` puis recommit.",
        );
        process.exit(1);
      }
      console.log("[codegen:enums] check OK — fichier généré à jour.");
      return;
    }
    console.log(output);
    return;
  }

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, output, "utf-8");
  console.log(
    `[codegen:enums] ${enums.length} enums générés → ${path.relative(
      path.resolve(__dirname, ".."),
      OUTPUT_FILE,
    )}`,
  );
}

// Lance main() seulement si exécuté en CLI direct, pas pendant un import
// vitest (qui charge le fichier pour exposer __test__).
if (!process.env.VITEST) {
  main();
}

export const __test__ = {
  stripComments,
  normalize,
  extractStringLiterals,
  scanCheckBody,
  extractFromMigration,
  generateOutput,
  constName,
  typeName,
  findMatchingParen,
};
