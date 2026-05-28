import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { checkColumnGrants } from "../../scripts/check-column-grants";

// Fixtures vivent dans tests/fixtures/check-column-grants/{nom}/<file>.sql.
// Chaque fixture est un répertoire à plat de migrations (le script attend
// directement le dossier qui contient les .sql, pas son parent).
const fixtureDir = (name: string) =>
  resolve(__dirname, "..", "fixtures", "check-column-grants", name);

const scriptPath = resolve(__dirname, "..", "..", "scripts", "check-column-grants.ts");

describe("checkColumnGrants — garde anti-régression PR #206", () => {
  it("détecte le drift sur une migration qui ajoute une colonne producers sans GRANT ni whitelist", () => {
    const result = checkColumnGrants(fixtureDir("violation"));
    expect(result.drift).toHaveLength(1);
    expect(result.drift[0]).toMatchObject({
      table: "producers",
      column: "fixture_violation_col",
    });
  });

  it("ne signale pas de drift quand la colonne est ajoutée AVEC GRANT SELECT explicite", () => {
    const result = checkColumnGrants(fixtureDir("ok-with-grant"));
    expect(result.drift).toHaveLength(0);
    expect(result.dedupAdded.has("producers.fixture_public_col")).toBe(true);
    expect(result.grantedSet.has("producers.fixture_public_col")).toBe(true);
  });

  it("ignore les colonnes ajoutées sur des tables hors liste blanche", () => {
    const result = checkColumnGrants(fixtureDir("ok-other-table"));
    expect(result.drift).toHaveLength(0);
    expect(result.dedupAdded.size).toBe(0);
  });

  // Chantier indisponibilités (2026-05-28) : `unavailabilities` rejoint la
  // liste blanche. Mêmes invariants que producers : ADD COLUMN sans GRANT
  // ni whitelist → drift.
  it("détecte le drift sur une migration qui ajoute une colonne unavailabilities sans GRANT ni whitelist", () => {
    const result = checkColumnGrants(fixtureDir("unavail-violation"));
    expect(result.drift).toHaveLength(1);
    expect(result.drift[0]).toMatchObject({
      table: "unavailabilities",
      column: "fixture_unavail_violation_col",
    });
  });

  it("ne signale pas de drift quand la colonne unavailabilities est ajoutée AVEC GRANT SELECT explicite", () => {
    const result = checkColumnGrants(fixtureDir("ok-unavail-with-grant"));
    expect(result.drift).toHaveLength(0);
    expect(result.dedupAdded.has("unavailabilities.fixture_public_col")).toBe(true);
    expect(result.grantedSet.has("unavailabilities.fixture_public_col")).toBe(true);
  });
});

// Vérifie que la garde mord vraiment en mode CLI (exit code 1). Le CI
// exécute `npm run check:column-grants` qui tape sur process.exit ; ce test
// invoque le script comme la CI le ferait, contre une fixture en violation.
// On préfère `process.execPath` (binaire Node garanti dispo) à `npx` qui
// dépend du PATH et a un shim Windows (.cmd).
describe("check-column-grants CLI", () => {
  it("retourne exit code 1 face à une violation (cwd = fixture)", () => {
    // tsx via la version locale, résolvée depuis le repo
    const tsxPath = resolve(__dirname, "..", "..", "node_modules", "tsx", "dist", "cli.mjs");
    const result = spawnSync(
      process.execPath,
      [tsxPath, scriptPath],
      {
        // Le script lit `process.cwd() + "/supabase/migrations"`. On simule
        // ce layout en pointant cwd sur un parent qui contient un dossier
        // `supabase/migrations` peuplé de la fixture violation.
        cwd: resolve(__dirname, "..", "fixtures", "check-column-grants-cwd-violation"),
        encoding: "utf8",
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("fixture_violation_col");
  }, 15_000);
});
