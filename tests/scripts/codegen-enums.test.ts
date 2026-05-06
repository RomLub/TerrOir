import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import { __test__ } from "@/scripts/codegen-enums";

const {
  stripComments,
  scanCheckBody,
  extractFromMigration,
  generateOutput,
  constName,
  typeName,
  findMatchingParen,
} = __test__;

describe("codegen-enums :: stripComments", () => {
  it("supprime line comments mais préserve les strings", () => {
    expect(stripComments("create -- foo\ntable")).toBe("create \ntable");
    expect(stripComments("'foo--bar' -- comment")).toBe("'foo--bar' ");
  });

  it("supprime les block comments", () => {
    expect(stripComments("a /* xxx */ b")).toBe("a  b");
  });
});

describe("codegen-enums :: findMatchingParen", () => {
  it("trouve la paren fermante balancée", () => {
    expect(findMatchingParen("(a (b) c)", 0)).toBe(8);
  });

  it("ignore les parens à l'intérieur des strings", () => {
    expect(findMatchingParen("(a 'foo)bar' b)", 0)).toBe(14);
  });

  it("retourne -1 si pas de match", () => {
    expect(findMatchingParen("(a b c", 0)).toBe(-1);
  });
});

describe("codegen-enums :: scanCheckBody", () => {
  it("extrait `col in ('a', 'b')`", () => {
    const r = scanCheckBody("statut in ('pending', 'active', 'suspended')");
    expect(r).toEqual([
      {
        column: "statut",
        values: ["pending", "active", "suspended"],
        source: "in",
      },
    ]);
  });

  it("extrait `col <@ array['a', 'b']::text[]`", () => {
    const r = scanCheckBody(
      "especes <@ array['bovin', 'porcin']::text[]",
    );
    expect(r).toEqual([
      {
        column: "especes",
        values: ["bovin", "porcin"],
        source: "subset_array",
      },
    ]);
  });

  it("extrait depuis `is null or col in (...)`", () => {
    const r = scanCheckBody(
      "producer_response_status is null or producer_response_status in ('published', 'removed_admin')",
    );
    // Le pattern null OR ne matche pas le `in` lui-même côté regex `\w+ in`,
    // mais la 2e occurrence du nom `producer_response_status in (...)` est
    // bien capturée.
    const inPatterns = r.filter((p) => p.source === "in");
    expect(inPatterns.length).toBeGreaterThanOrEqual(1);
    expect(inPatterns[0]).toEqual({
      column: "producer_response_status",
      values: ["published", "removed_admin"],
      source: "in",
    });
  });

  it("retourne [] si pas de pattern enum", () => {
    expect(scanCheckBody("note between 1 and 5")).toEqual([]);
  });
});

describe("codegen-enums :: constName / typeName", () => {
  it("constName joint table+col en SCREAMING_SNAKE", () => {
    expect(constName("producers", "type_production")).toBe(
      "PRODUCERS_TYPE_PRODUCTION_VALUES",
    );
  });

  it("typeName produit du PascalCase", () => {
    expect(typeName("producers", "mode_elevage")).toBe("ProducersModeElevage");
    expect(typeName("orders", "statut")).toBe("OrdersStatut");
  });

  it("constName / typeName supportent les enums Postgres natifs", () => {
    expect(constName("_type", "myenum")).toBe("MYENUM_VALUES");
    expect(typeName("_type", "myenum")).toBe("Myenum");
  });
});

describe("codegen-enums :: extractFromMigration end-to-end", () => {
  it("extrait un enum depuis CREATE TABLE inline check", () => {
    const sql = `
      create table public.foo (
        id uuid,
        kind text check (kind in ('a', 'b', 'c'))
      );
    `;
    const acc = new Map();
    extractFromMigration(sql, "test.sql", acc);
    expect(acc.size).toBe(1);
    const def = acc.get("foo.kind");
    expect(def?.values).toEqual(["a", "b", "c"]);
  });

  it("extrait un enum depuis ALTER TABLE ADD CONSTRAINT (avec is null or)", () => {
    const sql = `
      alter table public.reviews
        add constraint reviews_x_check
        check (status is null or status in ('p', 'r'));
    `;
    const acc = new Map();
    extractFromMigration(sql, "test.sql", acc);
    const def = acc.get("reviews.status");
    expect(def?.values).toEqual(["p", "r"]);
  });

  it("la dernière définition gagne (DROP + ADD CONSTRAINT)", () => {
    const acc = new Map();
    extractFromMigration(
      "create table public.foo ( s text check (s in ('a', 'b')) );",
      "1.sql",
      acc,
    );
    extractFromMigration(
      "alter table public.foo add constraint foo_s_check check (s in ('a', 'b', 'c'));",
      "2.sql",
      acc,
    );
    expect(acc.get("foo.s")?.values).toEqual(["a", "b", "c"]);
  });

  it("DROP COLUMN supprime l'entrée stale", () => {
    const acc = new Map();
    extractFromMigration(
      "create table public.users ( role text check (role in ('a', 'b')) );",
      "1.sql",
      acc,
    );
    extractFromMigration(
      "alter table public.users drop column role;",
      "2.sql",
      acc,
    );
    expect(acc.has("users.role")).toBe(false);
  });

  it("extrait un enum array `<@ array[...]::text[]`", () => {
    const sql = `
      create table public.users (
        roles text[] check (roles <@ array['consumer', 'producer']::text[])
      );
    `;
    const acc = new Map();
    extractFromMigration(sql, "test.sql", acc);
    expect(acc.get("users.roles")?.values).toEqual([
      "consumer",
      "producer",
    ]);
  });
});

describe("codegen-enums :: generateOutput", () => {
  it("produit un fichier TS commenté trié alphabétiquement", () => {
    const out = generateOutput([
      {
        table: "z",
        column: "k",
        values: ["x"],
        source: "in",
        firstSeen: "1.sql",
        lastSeen: "2.sql",
      },
      {
        table: "a",
        column: "k",
        values: ["y"],
        source: "in",
        firstSeen: "1.sql",
        lastSeen: "1.sql",
      },
    ]);
    expect(out).toContain("AUTO-GENERATED");
    // Tri alpha : a.k AVANT z.k
    expect(out.indexOf("A_K_VALUES")).toBeLessThan(out.indexOf("Z_K_VALUES"));
    expect(out).toContain('export const A_K_VALUES = ["y"] as const;');
    expect(out).toContain("export type AK = (typeof A_K_VALUES)[number];");
  });
});

describe("codegen-enums :: parité fichier généré ↔ migrations actuelles", () => {
  // Garde-fou : le fichier checké lib/types/generated/enums.ts doit refléter
  // l'état actuel des migrations. Si quelqu'un ajoute une migration sans
  // rejouer `npm run codegen:enums`, ce test casse en CI.
  const MIGRATIONS_DIR = path.resolve(
    __dirname,
    "../../supabase/migrations",
  );
  const OUTPUT_FILE = path.resolve(
    __dirname,
    "../../lib/types/generated/enums.ts",
  );

  it("le fichier généré reflète exactement les migrations courantes", () => {
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const acc = new Map();
    for (const f of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf-8");
      extractFromMigration(sql, f, acc);
    }
    const expected = generateOutput([...acc.values()]);
    const actual = fs.readFileSync(OUTPUT_FILE, "utf-8");
    expect(actual.trim()).toBe(expected.trim());
  });
});
