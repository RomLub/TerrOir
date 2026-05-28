/**
 * scripts/check-column-grants.ts
 *
 * Vérifie que chaque colonne ajoutée à une table à grants column-level (liste
 * blanche) — actuellement `public.producers` — est soit suivie d'un
 * `GRANT SELECT (<col>) ON public.<table> TO ...`, soit explicitement
 * whitelistée comme owner-only ou admin-only.
 *
 * Pourquoi : régression PR #206 (2026-05-28). L'ajout de `producer_number` +
 * `next_order_seq` sans GRANT SELECT a rendu tout SELECT incluant ces
 * colonnes invalide pour les rôles client (42501 permission denied), cassant
 * l'espace producteur entier. Cf. CLAUDE.md §4 « Grants column-level ».
 *
 * Mode : parsing STATIQUE des fichiers `supabase/migrations/*.sql` (pas de
 * connexion DB requise → CI-friendly).
 *
 * Usage :
 *   npx tsx scripts/check-column-grants.ts            # check, exit 1 si drift
 *   npx tsx scripts/check-column-grants.ts --verbose  # détail
 *
 * Exit codes :
 *   0 = OK (toute colonne ajoutée a un GRANT ou est whitelistée)
 *   1 = drift détecté (colonne ajoutée sans GRANT et hors whitelist)
 *   2 = erreur (migrations introuvables, parse fail)
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// =============================================================================
// Configuration : tables au pattern liste blanche + whitelist owner-only / admin-only.
// =============================================================================

const WHITELIST_TABLES = ["producers"] as const;

type WhitelistEntry = { table: string; column: string; rationale: string };

const WHITELIST: readonly WhitelistEntry[] = [
  // ADR Cluster A (privacy 2026-05-07) : coords précises jamais lues
  // directement par anon/authenticated — passage forcé par la vue
  // `producers_public` qui floute à 2 décimales.
  { table: "producers", column: "latitude", rationale: "privacy — vue producers_public floutée" },
  { table: "producers", column: "longitude", rationale: "privacy — vue producers_public floutée" },

  // bio est public (exposé via la vue producers_public), pas besoin de grant
  // direct sur la table. Les surfaces consumer/owner passent par la vue
  // ou par server action admin (loadMaPageData).
  { table: "producers", column: "bio", rationale: "public via vue producers_public" },

  // Chantier 3 bio (2026-05-22) + workflow publication : déclarations
  // owner-sensitive. Lecture via server action admin + owner-check
  // (loadMaPageData). Pas de grant authenticated pour ne pas sur-exposer
  // via la policy "producers public read when public". Cf. ADR-0015 + PR #208.
  { table: "producers", column: "bio_certificate_number", rationale: "owner-only — server action loadMaPageData" },
  { table: "producers", column: "bio_validated_at", rationale: "owner-only — server action loadMaPageData" },
  { table: "producers", column: "publication_requested_at", rationale: "owner-only — server action loadMaPageData" },
];

// =============================================================================
// Parsing migrations
// =============================================================================

const MIGRATIONS_DIR = resolve(process.cwd(), "supabase/migrations");

// Match `ADD COLUMN [IF NOT EXISTS] <col> <type ...>` — capture col name.
// Tolérant aux variations de quotage, casse, et IF NOT EXISTS.
const ADD_COLUMN_RE =
  /alter\s+table\s+(?:only\s+)?(?:public\.)?"?(\w+)"?\s+add\s+column(?:\s+if\s+not\s+exists)?\s+"?(\w+)"?/gi;

// Match `DROP COLUMN [IF EXISTS] <col>` — capture col name. Permet de
// retirer du suivi les colonnes supprimées par une migration ultérieure.
const DROP_COLUMN_RE =
  /alter\s+table\s+(?:only\s+)?(?:public\.)?"?(\w+)"?\s+drop\s+column(?:\s+if\s+exists)?\s+"?(\w+)"?/gi;

// Match `GRANT SELECT (col1, col2, ...) ON [public.]<table> TO ...`
// Capture la table + la liste des colonnes brute (à splitter ensuite).
const GRANT_SELECT_RE =
  /grant\s+select\s*\(([^)]+)\)\s+on\s+(?:public\.)?"?(\w+)"?\s+to\s+/gi;

type AddedColumn = { table: string; column: string; migration: string };
type GrantedColumn = { table: string; column: string; migration: string };
type DroppedColumn = { table: string; column: string; migration: string };

function parseMigrations(): {
  added: AddedColumn[];
  granted: GrantedColumn[];
  dropped: DroppedColumn[];
} {
  let files: string[];
  try {
    files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Impossible de lire ${MIGRATIONS_DIR} : ${msg}`,
    );
  }

  const added: AddedColumn[] = [];
  const granted: GrantedColumn[] = [];
  const dropped: DroppedColumn[] = [];

  for (const file of files) {
    const path = join(MIGRATIONS_DIR, file);
    const sql = readFileSync(path, "utf8");

    // Reset regex state (global flag).
    ADD_COLUMN_RE.lastIndex = 0;
    DROP_COLUMN_RE.lastIndex = 0;
    GRANT_SELECT_RE.lastIndex = 0;

    let m: RegExpExecArray | null;
    while ((m = ADD_COLUMN_RE.exec(sql)) !== null) {
      const [, table, column] = m;
      if (table && column && (WHITELIST_TABLES as readonly string[]).includes(table)) {
        added.push({ table, column, migration: file });
      }
    }
    while ((m = DROP_COLUMN_RE.exec(sql)) !== null) {
      const [, table, column] = m;
      if (table && column && (WHITELIST_TABLES as readonly string[]).includes(table)) {
        dropped.push({ table, column, migration: file });
      }
    }
    while ((m = GRANT_SELECT_RE.exec(sql)) !== null) {
      const [, colsRaw, table] = m;
      if (!table || !colsRaw) continue;
      if (!(WHITELIST_TABLES as readonly string[]).includes(table)) continue;
      const cols = colsRaw
        .split(",")
        .map((c) => c.trim().replace(/^"|"$/g, ""))
        .filter(Boolean);
      for (const col of cols) {
        granted.push({ table, column: col, migration: file });
      }
    }
  }

  return { added, granted, dropped };
}

// =============================================================================
// Diagnostic
// =============================================================================

function main(): void {
  const verbose = process.argv.includes("--verbose");

  let added: AddedColumn[];
  let granted: GrantedColumn[];
  let dropped: DroppedColumn[];
  try {
    ({ added, granted, dropped } = parseMigrations());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`✗ ${msg}`);
    process.exit(2);
  }

  const grantedKey = (t: string, c: string) => `${t}.${c}`;
  const grantedSet = new Set(granted.map((g) => grantedKey(g.table, g.column)));
  const droppedSet = new Set(dropped.map((d) => grantedKey(d.table, d.column)));
  const whitelistSet = new Set(WHITELIST.map((w) => grantedKey(w.table, w.column)));

  // On déduplique les ADD COLUMN par (table, column) : une colonne peut être
  // déclarée plusieurs fois via IF NOT EXISTS dans plusieurs migrations.
  // On retire aussi les colonnes droppées par une migration ultérieure (la
  // colonne n'existe plus en DB → pas de drift possible).
  const dedupAdded = new Map<string, AddedColumn>();
  for (const a of added) {
    const key = grantedKey(a.table, a.column);
    if (droppedSet.has(key)) continue;
    if (!dedupAdded.has(key)) dedupAdded.set(key, a);
  }

  const drift: AddedColumn[] = [];
  for (const [key, a] of dedupAdded) {
    if (grantedSet.has(key)) continue; // GRANT SELECT explicite trouvé
    if (whitelistSet.has(key)) continue; // whitelisté
    drift.push(a);
  }

  if (verbose) {
    console.log("=".repeat(70));
    console.log("check-column-grants — résultat");
    console.log("=".repeat(70));
    console.log(`Tables surveillées : ${WHITELIST_TABLES.join(", ")}`);
    console.log(`Colonnes ajoutées via ADD COLUMN : ${dedupAdded.size}`);
    console.log(`Colonnes avec GRANT SELECT explicite : ${grantedSet.size}`);
    console.log(`Colonnes whitelistées (owner-only / privacy) : ${WHITELIST.length}`);
    console.log(`Drift détecté : ${drift.length}`);
    console.log("");
    if (dedupAdded.size > 0) {
      console.log("Inventaire :");
      for (const [, a] of dedupAdded) {
        const key = grantedKey(a.table, a.column);
        const tag = grantedSet.has(key)
          ? "[GRANT SELECT]"
          : whitelistSet.has(key)
            ? `[whitelist: ${WHITELIST.find((w) => grantedKey(w.table, w.column) === key)?.rationale}]`
            : "[DRIFT]";
        console.log(`  - ${a.table}.${a.column} ${tag} (${a.migration})`);
      }
    }
    console.log("=".repeat(70));
  }

  if (drift.length > 0) {
    console.error(
      `✗ ${drift.length} colonne(s) ajoutée(s) sans GRANT SELECT explicite ni whitelist :`,
    );
    for (const a of drift) {
      console.error(`  - ${a.table}.${a.column} (ajoutée par ${a.migration})`);
    }
    console.error("\nAction requise (cf. CLAUDE.md §4 « Grants column-level ») :");
    console.error(
      "  - Soit ajouter dans une migration : `GRANT SELECT (<col>) ON public.<table> TO anon, authenticated;`",
    );
    console.error(
      "  - Soit garder la colonne owner-only (lecture via server action admin) ET l'ajouter à WHITELIST dans ce script.",
    );
    process.exit(1);
  }

  console.log(
    `✓ Aucun drift de grants column-level (${dedupAdded.size} colonne(s) ajoutée(s) à des tables liste blanche, ${grantedSet.size} avec GRANT, ${WHITELIST.length} whitelistée(s)).`,
  );
  process.exit(0);
}

main();
