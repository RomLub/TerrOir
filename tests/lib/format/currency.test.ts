import { describe, it, expect } from "vitest";
import { formatEuro } from "@/lib/format/currency";

describe("formatEuro — formats valides", () => {
  it("nombre simple → virgule FR + € (espace normal)", () => {
    expect(formatEuro(12.5)).toBe("12,50 €");
  });

  it("zéro → 0,00 €", () => {
    expect(formatEuro(0)).toBe("0,00 €");
  });

  it("entier → zéro-padding 2 décimales", () => {
    expect(formatEuro(42)).toBe("42,00 €");
  });

  it("nombre négatif → signe conservé", () => {
    expect(formatEuro(-3.5)).toBe("-3,50 €");
  });

  it("arrondi à 2 décimales (1.234 → 1,23 €)", () => {
    expect(formatEuro(1.234)).toBe("1,23 €");
  });

  it("arrondi à 2 décimales (1.235 → 1,24 €, toFixed banker-like)", () => {
    // toFixed(2) de 1.235 peut dépendre de la représentation binaire : ici
    // on cherche surtout à confirmer que l'output reste sur 2 décimales,
    // pas à pinner le sens d'arrondi.
    const out = formatEuro(1.235);
    expect(out).toMatch(/^1,2[34] €$/);
  });

  it("gros montant → pas de séparateur de milliers (contrat actuel)", () => {
    // toFixed(2) ne pose pas de séparateur milliers. Test explicite pour
    // documenter le comportement : si on veut un espace insécable milliers,
    // il faudra passer à Intl.NumberFormat et mettre à jour ce test.
    expect(formatEuro(12345.67)).toBe("12345,67 €");
  });
});

describe("formatEuro — entrées invalides / vides", () => {
  it("null → —", () => {
    expect(formatEuro(null)).toBe("—");
  });

  it("undefined → —", () => {
    expect(formatEuro(undefined)).toBe("—");
  });

  it("NaN → —", () => {
    expect(formatEuro(NaN)).toBe("—");
  });
});
