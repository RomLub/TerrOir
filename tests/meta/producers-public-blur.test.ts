// =============================================================================
// T-217-bis (Cluster A) — Test contractuel : vue producers_public + verrou
// DB-level lat/lng. Scan statique des migrations pour verrouiller les
// invariants privacy doctrine.
// =============================================================================
//
// Ce test ne tourne PAS contre une DB live (pas de cout Docker / setup) — il
// inspecte le contenu des migrations canoniques du repo pour garantir que :
//
//   1. La derniere version de la vue producers_public projette latitude et
//      longitude via `round(...::numeric, 2)` (floutage 2 decimales).
//   2. La derniere migration Cluster A revoque bien SELECT sur la table
//      producers pour anon + authenticated, ET re-grante les colonnes
//      autorisees SANS latitude/longitude.
//
// Si une future migration regresse le floutage (par exemple en re-projetant
// lat/lng bruts dans la vue, ou en re-grantant SELECT(latitude) a anon), ce
// test fail et bloque le merge.
//
// Convention : la vue est susceptible d'evoluer (T-227 grille commune-
// centroide etc.) → ce test cible specifiquement la *derniere* definition
// active dans les migrations, pas une version particuliere.
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");

function readMigrationsByPrefix(): { file: string; content: string }[] {
  const entries = fs.readdirSync(MIGRATIONS_DIR);
  return entries
    .filter((f) => f.endsWith(".sql"))
    .sort() // ordre lexical = ordre application
    .map((f) => ({
      file: f,
      content: fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf-8"),
    }));
}

describe("T-217-bis Cluster A — invariants migrations privacy lat/lng", () => {
  it("la derniere migration creant producers_public floute lat/lng a 2 decimales", () => {
    const migrations = readMigrationsByPrefix();

    // Cherche les migrations qui CREATE VIEW producers_public.
    const matching = migrations.filter((m) =>
      /create\s+view\s+(?:public\.)?producers_public/i.test(m.content),
    );

    expect(matching.length).toBeGreaterThan(0);

    // La DERNIERE migration qui (re)cree la vue est canonique. Elle DOIT
    // appliquer round(lat::numeric, 2) et round(lng::numeric, 2).
    const last = matching[matching.length - 1]!;

    // round() sur latitude
    expect(last.content).toMatch(
      /round\s*\(\s*(?:p\.)?latitude::numeric\s*,\s*2\s*\)/i,
    );
    // round() sur longitude
    expect(last.content).toMatch(
      /round\s*\(\s*(?:p\.)?longitude::numeric\s*,\s*2\s*\)/i,
    );

    // Garde-fou : la vue ne doit JAMAIS exposer latitude/longitude bruts
    // (sans round). Pattern naif mais suffisant : on cherche `, latitude,`
    // ou `, longitude,` dans la projection — si present sans round, fail.
    // On accepte les references "p.latitude" en INPUT du round() ou dans
    // la WHERE-clause (filtrer is not null).
    const projectionLines = last.content
      .split("\n")
      .map((l) => l.trim());
    for (const line of projectionLines) {
      // skip commentaires
      if (line.startsWith("--")) continue;
      // skip WHERE-clause
      if (line.toLowerCase().startsWith("where ")) continue;
      // une projection brute ressemblerait a "p.latitude," ou "latitude," sans round
      if (
        /^\s*(?:p\.)?(latitude|longitude)\s*,?\s*(?:--.*)?$/i.test(line) &&
        !line.toLowerCase().includes("round")
      ) {
        throw new Error(
          `T-217-bis : projection brute lat/lng detectee dans ${last.file}\n` +
            `  ligne : ${line}\n` +
            `  → ajouter round(...::numeric, 2) ou exclure de la projection.`,
        );
      }
    }
  });

  it("la migration Cluster A revoque SELECT table-level lat/lng pour anon et authenticated", () => {
    const migrations = readMigrationsByPrefix();
    const cluster = migrations.find((m) =>
      m.file.includes("cluster_a_privacy_lat_lng") ||
      m.file.startsWith("20260507A"),
    );
    expect(cluster).toBeDefined();
    expect(cluster!.content).toMatch(
      /revoke\s+select\s+on\s+(?:public\.)?producers\s+from\s+anon/i,
    );
    expect(cluster!.content).toMatch(
      /revoke\s+select\s+on\s+(?:public\.)?producers\s+from\s+authenticated/i,
    );
  });

  it("la migration Cluster A re-grante les colonnes publiques SANS latitude/longitude", () => {
    const migrations = readMigrationsByPrefix();
    const cluster = migrations.find((m) =>
      m.file.includes("cluster_a_privacy_lat_lng") ||
      m.file.startsWith("20260507A"),
    );
    expect(cluster).toBeDefined();

    // On scope la verification aux GRANT SELECT (col-list) ON producers TO
    // (anon|authenticated). Le pattern matche un bloc multi-lignes.
    const grantPattern =
      /grant\s+select\s*\(([\s\S]*?)\)\s+on\s+(?:public\.)?producers\s+to\s+(anon|authenticated)/gi;

    const matches = [...cluster!.content.matchAll(grantPattern)];
    expect(matches.length).toBeGreaterThanOrEqual(2); // anon + authenticated

    for (const match of matches) {
      const colList = match[1]!.toLowerCase();
      // latitude/longitude NE DOIVENT PAS apparaitre dans la liste
      // (matching mot entier pour eviter faux-positif sur "longitude_xxx").
      expect(colList).not.toMatch(/\blatitude\b/);
      expect(colList).not.toMatch(/\blongitude\b/);
    }
  });

  it("la RPC search_producers floute lat/lng dans le SELECT final", () => {
    const migrations = readMigrationsByPrefix();
    // Cherche la derniere migration qui (re)definit search_producers.
    const matching = migrations.filter((m) =>
      /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?search_producers/i.test(
        m.content,
      ),
    );
    expect(matching.length).toBeGreaterThan(0);
    const last = matching[matching.length - 1]!;

    // La derniere version DOIT projeter round(lat) et round(lng) en sortie.
    expect(last.content).toMatch(
      /round\s*\(\s*\w+\.latitude::numeric\s*,\s*2\s*\)/i,
    );
    expect(last.content).toMatch(
      /round\s*\(\s*\w+\.longitude::numeric\s*,\s*2\s*\)/i,
    );
  });
});
