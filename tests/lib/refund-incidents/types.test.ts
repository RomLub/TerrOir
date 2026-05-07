import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  REFUND_KINDS,
  REFUND_INCIDENT_STATUSES,
  REFUND_ATTEMPT_OUTCOMES,
} from "@/lib/refund-incidents/types";

// Anti-régression contractuel TS↔DDL pour le chantier T-102.1.
//
// Le repo n'a pas d'infra de test d'intégration DB Supabase isolée
// (cf. T-102.1 inspection §3 : tous les tests sont unitaires avec mocks).
// On ne peut donc pas vérifier les CHECK constraints en exécutant des
// INSERT contre une vraie DB. À défaut, on s'assure que les valeurs
// énumérées en TS (REFUND_KINDS, REFUND_INCIDENT_STATUSES,
// REFUND_ATTEMPT_OUTCOMES) restent strictement alignées avec les CHECK
// constraints de la migration. Toute drift d'un côté sans l'autre fait
// péter ce test.
//
// Pattern de parsing : extraction par regex des CHECK ... IN (...) clauses
// de la migration. Volontairement simple et stupide — si quelqu'un
// reformule la migration, le test échoue, et c'est le signal d'aller
// re-vérifier la cohérence à la main.

const MIGRATION_PATH = resolve(
  __dirname,
  "../../../supabase/migrations/20260501231300_t102_1_refund_incidents.sql",
);

// Override migration 2026-05-07 (Cluster B Phase 3) : ajout 'manual_cancel'
// a l'enum kind via DROP + ADD CHECK constraint (cancel/route.tsx). Pour
// que le test ↔ DDL soit fidele a l'etat courant, on lit la migration
// override en plus de l'originale et on prend la liste effective.
const MIGRATION_PATH_KIND_OVERRIDE = resolve(
  __dirname,
  "../../../supabase/migrations/20260507120000_t102_2_manual_cancel_kind.sql",
);

const migrationSql = readFileSync(MIGRATION_PATH, "utf8");
const migrationSqlKindOverride = readFileSync(
  MIGRATION_PATH_KIND_OVERRIDE,
  "utf8",
);

function extractCheckInValues(
  sql: string,
  columnName: string,
): readonly string[] {
  // Match: <columnName> ... check (<columnName> in ('a', 'b', 'c'))
  // Tolère les sauts de ligne et espaces variables.
  const re = new RegExp(
    `${columnName}\\s+text[^,]*?check\\s*\\(\\s*${columnName}\\s+in\\s*\\(([^)]*)\\)\\s*\\)`,
    "is",
  );
  const match = sql.match(re);
  if (!match) {
    throw new Error(
      `CHECK ${columnName} IN (...) introuvable dans la migration`,
    );
  }
  return match[1]!
    .split(",")
    .map((v) => v.trim().replace(/^'|'$/g, ""))
    .filter((v) => v.length > 0);
}

// Pour ALTER TABLE ADD CONSTRAINT (override 2026-05-07).
function extractCheckInValuesFromAlter(
  sql: string,
  columnName: string,
): readonly string[] {
  const re = new RegExp(
    `add\\s+constraint\\s+\\w+\\s+check\\s*\\(\\s*${columnName}\\s+in\\s*\\(([^)]*)\\)\\s*\\)`,
    "is",
  );
  const match = sql.match(re);
  if (!match) {
    throw new Error(
      `ALTER TABLE ... CHECK ${columnName} IN (...) introuvable`,
    );
  }
  return match[1]!
    .split(",")
    .map((v) => v.trim().replace(/^'|'$/g, ""))
    .filter((v) => v.length > 0);
}

describe("T-102.1 — refund-incidents types ↔ migration DDL", () => {
  it("REFUND_KINDS aligné avec CHECK kind IN (...) de la migration override (2026-05-07)", () => {
    // Source de verite courante : migration override 2026-05-07 (ajout
    // 'manual_cancel'). La migration originale T-102.1 ne contient plus
    // que les 3 kinds historiques, l'override les remplace.
    const ddlValues = extractCheckInValuesFromAlter(
      migrationSqlKindOverride,
      "kind",
    );
    expect([...REFUND_KINDS].sort()).toEqual([...ddlValues].sort());
  });

  it("REFUND_INCIDENT_STATUSES aligné avec CHECK status IN (...) de la migration", () => {
    const ddlValues = extractCheckInValues(migrationSql, "status");
    expect([...REFUND_INCIDENT_STATUSES].sort()).toEqual(
      [...ddlValues].sort(),
    );
  });

  it("REFUND_ATTEMPT_OUTCOMES aligné avec CHECK outcome IN (...) de la migration", () => {
    const ddlValues = extractCheckInValues(migrationSql, "outcome");
    expect([...REFUND_ATTEMPT_OUTCOMES].sort()).toEqual(
      [...ddlValues].sort(),
    );
  });

  it("REFUND_KINDS contient les 4 paths refund (revival, admin, timeout, manual_cancel)", () => {
    expect([...REFUND_KINDS].sort()).toEqual([
      "admin",
      "manual_cancel",
      "revival",
      "timeout",
    ]);
  });

  it("REFUND_INCIDENT_STATUSES contient les 6 lifecycle states attendus", () => {
    expect([...REFUND_INCIDENT_STATUSES].sort()).toEqual([
      "aborted",
      "exhausted",
      "manually_resolved",
      "pending",
      "retrying",
      "succeeded",
    ]);
  });

  it("REFUND_ATTEMPT_OUTCOMES contient exactement failed et succeeded", () => {
    expect([...REFUND_ATTEMPT_OUTCOMES].sort()).toEqual([
      "failed",
      "succeeded",
    ]);
  });

  it("la migration contient bien la contrainte UNIQUE (order_id, kind) sur refund_incidents", () => {
    expect(migrationSql).toMatch(/unique\s*\(\s*order_id\s*,\s*kind\s*\)/i);
  });

  it("la migration contient bien la contrainte UNIQUE (refund_incident_id, attempt_number)", () => {
    expect(migrationSql).toMatch(
      /unique\s*\(\s*refund_incident_id\s*,\s*attempt_number\s*\)/i,
    );
  });

  it("la migration définit la cascade DELETE refund_incidents → refund_incident_attempts", () => {
    expect(migrationSql).toMatch(
      /references\s+public\.refund_incidents\(id\)\s+on\s+delete\s+cascade/i,
    );
  });

  it("la migration pose le trigger refund_incidents_set_updated_at appelant public.set_updated_at()", () => {
    expect(migrationSql).toMatch(/create\s+trigger\s+refund_incidents_set_updated_at/i);
    expect(migrationSql).toMatch(/execute\s+function\s+public\.set_updated_at\(\)/i);
  });

  it("la migration pose RLS admin-only sur les 2 tables", () => {
    expect(migrationSql).toMatch(
      /alter\s+table\s+public\.refund_incidents\s+enable\s+row\s+level\s+security/i,
    );
    expect(migrationSql).toMatch(
      /alter\s+table\s+public\.refund_incident_attempts\s+enable\s+row\s+level\s+security/i,
    );
    // Lookup admin via admin_users.id = auth.uid() (pattern audit_logs/disputes).
    const adminPolicyCount = (
      migrationSql.match(/from\s+public\.admin_users\s+where\s+id\s*=\s*auth\.uid\(\)/gi) ?? []
    ).length;
    expect(adminPolicyCount).toBe(2);
  });

  it("la migration NE recrée PAS la fonction set_updated_at() (déjà posée en 20260429030000)", () => {
    // La fonction est posée par migration 20260429030000_payouts_updated_at_error_msg.sql.
    // T-102.1 doit se contenter d'attacher un trigger qui l'appelle.
    expect(migrationSql).not.toMatch(/create\s+or\s+replace\s+function\s+public\.set_updated_at/i);
  });

  it("la migration contient les 4 indexes attendus sur refund_incidents", () => {
    expect(migrationSql).toMatch(/refund_incidents_status_kind_open_idx[\s\S]*?where\s+status\s+in\s*\(\s*'pending'\s*,\s*'retrying'\s*\)/i);
    expect(migrationSql).toMatch(/refund_incidents_consumer_id_idx/i);
    expect(migrationSql).toMatch(/refund_incidents_created_at_idx/i);
    expect(migrationSql).toMatch(/refund_incidents_order_id_idx/i);
  });

  it("la migration contient les 2 indexes attendus sur refund_incident_attempts", () => {
    expect(migrationSql).toMatch(/refund_incident_attempts_incident_id_idx/i);
    expect(migrationSql).toMatch(/refund_incident_attempts_attempted_at_idx/i);
  });
});
