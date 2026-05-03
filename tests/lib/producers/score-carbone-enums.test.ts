import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ALIMENTATION_VALUES,
  ALIMENTATION_LABELS,
  ALIMENTATION_PUBLIC_LABELS,
  ALIMENTATION_HINTS,
  DENSITE_ANIMALE_VALUES,
  DENSITE_ANIMALE_LABELS,
  DENSITE_ANIMALE_PUBLIC_LABELS,
  DENSITE_ANIMALE_HINTS,
  MODE_ELEVAGE_VALUES,
  MODE_ELEVAGE_LABELS,
  MODE_ELEVAGE_PUBLIC_LABELS,
  MODE_ELEVAGE_HINTS,
} from "@/lib/producers/score-carbone-enums";

// Garde-fou anti-dérive TS ↔ SQL : les CHECK constraints de la migration
// 20260503100000_t200_score_carbone.sql doivent contenir EXACTEMENT les
// mêmes valeurs que les constantes TS. Si quelqu'un ajoute une valeur côté
// TS sans rejouer une migration (ou inversement), ce test casse — la dérive
// silencieuse causerait un INSERT rejeté par CHECK en runtime.
//
// Décision comité review T-200 round 1 (technique).

const MIGRATION_PATH = resolve(
  __dirname,
  "../../../supabase/migrations/20260503100000_t200_score_carbone.sql",
);

function extractCheckValues(sql: string, column: string): string[] {
  // Match : `<column> in ('a', 'b', 'c')` (insensible à la casse, multi-ligne)
  const re = new RegExp(`${column}\\s+in\\s*\\(([^)]+)\\)`, "i");
  const match = sql.match(re);
  if (!match) {
    throw new Error(`CHECK introuvable pour la colonne ${column}`);
  }
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe("score-carbone-enums — parité TS ↔ CHECK SQL (anti-dérive)", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf-8");

  it("MODE_ELEVAGE_VALUES = CHECK migration mode_elevage", () => {
    const sqlValues = extractCheckValues(sql, "mode_elevage");
    expect([...sqlValues].sort()).toEqual([...MODE_ELEVAGE_VALUES].sort());
  });

  it("ALIMENTATION_VALUES = CHECK migration alimentation", () => {
    const sqlValues = extractCheckValues(sql, "alimentation");
    expect([...sqlValues].sort()).toEqual([...ALIMENTATION_VALUES].sort());
  });

  it("DENSITE_ANIMALE_VALUES = CHECK migration densite_animale", () => {
    const sqlValues = extractCheckValues(sql, "densite_animale");
    expect([...sqlValues].sort()).toEqual([...DENSITE_ANIMALE_VALUES].sort());
  });
});

describe("score-carbone-enums — exhaustivité Records (TS guard)", () => {
  // Les Record<Enum, string> doivent couvrir TOUTES les valeurs de l'enum.
  // Si on ajoute une valeur à un VALUES sans alimenter LABELS/PUBLIC/HINTS,
  // TS le détecte à la compilation MAIS uniquement si on respecte le typage
  // strict — ce test vérifie aussi la couverture en runtime.

  it("MODE_ELEVAGE — chaque valeur a un LABELS, PUBLIC_LABELS, HINTS", () => {
    for (const v of MODE_ELEVAGE_VALUES) {
      expect(MODE_ELEVAGE_LABELS[v]).toBeTruthy();
      expect(MODE_ELEVAGE_PUBLIC_LABELS[v]).toBeTruthy();
      expect(MODE_ELEVAGE_HINTS[v]).toBeTruthy();
    }
  });

  it("ALIMENTATION — chaque valeur a un LABELS, PUBLIC_LABELS, HINTS", () => {
    for (const v of ALIMENTATION_VALUES) {
      expect(ALIMENTATION_LABELS[v]).toBeTruthy();
      expect(ALIMENTATION_PUBLIC_LABELS[v]).toBeTruthy();
      expect(ALIMENTATION_HINTS[v]).toBeTruthy();
    }
  });

  it("DENSITE_ANIMALE — chaque valeur a un LABELS, PUBLIC_LABELS, HINTS", () => {
    for (const v of DENSITE_ANIMALE_VALUES) {
      expect(DENSITE_ANIMALE_LABELS[v]).toBeTruthy();
      expect(DENSITE_ANIMALE_PUBLIC_LABELS[v]).toBeTruthy();
      expect(DENSITE_ANIMALE_HINTS[v]).toBeTruthy();
    }
  });
});

describe("score-carbone-enums — différenciation labels public vs onboarding", () => {
  // Décision comité review T-200 round 1 (produit) : les libellés affichés
  // côté consumer sont en langage parlé, pas en jargon agronomique.
  // On vérifie ici que les labels publics ALIMENTATION et DENSITE diffèrent
  // bien des labels techniques (smoke contre une régression accidentelle où
  // quelqu'un alignerait les deux sets et perdrait la nuance grand public).

  it("ALIMENTATION_PUBLIC_LABELS != ALIMENTATION_LABELS sur au moins 2 valeurs", () => {
    const diffs = ALIMENTATION_VALUES.filter(
      (v) => ALIMENTATION_PUBLIC_LABELS[v] !== ALIMENTATION_LABELS[v],
    );
    expect(diffs.length).toBeGreaterThanOrEqual(2);
  });

  it("DENSITE_ANIMALE_PUBLIC_LABELS != DENSITE_ANIMALE_LABELS sur les 3 valeurs", () => {
    const diffs = DENSITE_ANIMALE_VALUES.filter(
      (v) =>
        DENSITE_ANIMALE_PUBLIC_LABELS[v] !== DENSITE_ANIMALE_LABELS[v],
    );
    expect(diffs.length).toBe(3);
  });
});
