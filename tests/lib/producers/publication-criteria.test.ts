import { describe, it, expect } from "vitest";
import { PUBLICATION_CRITERIA } from "@/lib/producers/publication-criteria";
import type { PublicationCriteria } from "@/lib/producers/publication-status";

// Source unique des critères de mise en ligne — verrouille la cohérence
// avec le type `PublicationCriteria` (qui mirror la RPC SQL get_publication_
// status) et la qualité des libellés courts utilisés inline dans la carte
// dashboard.

describe("PUBLICATION_CRITERIA", () => {
  it("compte 6 entrées (parité avec la RPC SQL)", () => {
    expect(PUBLICATION_CRITERIA.length).toBe(6);
  });

  it("couvre exactement les clés de PublicationCriteria sans doublon", () => {
    const expectedKeys: ReadonlyArray<keyof PublicationCriteria> = [
      "description",
      "photo_principale",
      "localisation",
      "stripe",
      "product_with_photo",
      "open_slot",
    ];
    const actualKeys = PUBLICATION_CRITERIA.map((c) => c.key);
    expect(new Set(actualKeys)).toEqual(new Set(expectedKeys));
    expect(new Set(actualKeys).size).toBe(actualKeys.length);
  });

  it("chaque shortLabel est non vide et reste court (< 25 caractères)", () => {
    for (const c of PUBLICATION_CRITERIA) {
      expect(c.shortLabel.length).toBeGreaterThan(0);
      expect(c.shortLabel.length).toBeLessThan(25);
    }
  });

  it("chaque label long est non vide", () => {
    for (const c of PUBLICATION_CRITERIA) {
      expect(c.label.length).toBeGreaterThan(0);
    }
  });

  it("chaque critère a un href défini (rendant l'étape actionnable)", () => {
    for (const c of PUBLICATION_CRITERIA) {
      expect(c.href.length).toBeGreaterThan(0);
      expect(c.href.startsWith("/")).toBe(true);
    }
  });

  it("les 3 critères sans page dédiée pointent vers /ma-page?tab=edit&focus=…", () => {
    const inMaPage: ReadonlyArray<keyof PublicationCriteria> = [
      "description",
      "photo_principale",
      "localisation",
    ];
    for (const key of inMaPage) {
      const c = PUBLICATION_CRITERIA.find((entry) => entry.key === key);
      expect(c, `critère ${key} introuvable`).toBeDefined();
      expect(c!.href).toMatch(/^\/ma-page\?tab=edit&focus=ma-page-/);
    }
  });
});
