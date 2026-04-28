import { describe, it, expect } from "vitest";
import {
  GMS_MAILLONS,
  TERROIR_MAILLONS,
} from "@/components/ui/circuit-visualizer";

// Tests data-invariant uniquement — le repo n'a pas de setup React Testing
// Library (vitest env=node, pas de jsdom, pas de .test.tsx). On valide les
// invariants critiques des placeholders affichés sur /notre-demarche.

describe("CircuitVisualizer — invariants data placeholder", () => {
  it("GMS_MAILLONS somme à 100", () => {
    const total = GMS_MAILLONS.reduce((acc, m) => acc + m.share, 0);
    expect(total).toBe(100);
  });

  it("TERROIR_MAILLONS somme à 100", () => {
    const total = TERROIR_MAILLONS.reduce((acc, m) => acc + m.share, 0);
    expect(total).toBe(100);
  });

  // Brief Phase C mentionnait "8 maillons GMS" mais ne listait que 7 noms
  // sommant à 100 (Éleveur, Négociant, Abattoir, Atelier découpe, Logistique,
  // Centrale, Magasin). On aligne sur les 7 noms réellement listés — même
  // logique que TerrOir 5→4 (Consommateur exclu car arrivée du flux, pas
  // maillon de marge).
  it("GMS_MAILLONS contient 7 maillons (brief Phase C aligné noms listés)", () => {
    expect(GMS_MAILLONS).toHaveLength(7);
  });

  it("TERROIR_MAILLONS contient 4 maillons (brief Phase C, Consommateur exclu)", () => {
    expect(TERROIR_MAILLONS).toHaveLength(4);
  });

  it("Éleveur est le 1er maillon des deux filières (ordre du flux)", () => {
    expect(GMS_MAILLONS[0]?.label).toBe("Éleveur");
    expect(TERROIR_MAILLONS[0]?.label).toBe("Éleveur");
  });

  it("Part éleveur GMS << part éleveur TerrOir (cœur du message produit)", () => {
    const gmsEleveur = GMS_MAILLONS[0]?.share ?? 0;
    const terroirEleveur = TERROIR_MAILLONS[0]?.share ?? 0;
    expect(gmsEleveur).toBeLessThan(terroirEleveur);
    expect(terroirEleveur - gmsEleveur).toBeGreaterThanOrEqual(50);
  });

  it("toutes les parts sont des entiers ∈ [0, 100]", () => {
    const all = [...GMS_MAILLONS, ...TERROIR_MAILLONS];
    for (const m of all) {
      expect(Number.isInteger(m.share)).toBe(true);
      expect(m.share).toBeGreaterThanOrEqual(0);
      expect(m.share).toBeLessThanOrEqual(100);
    }
  });
});
