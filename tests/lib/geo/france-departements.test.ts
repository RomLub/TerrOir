import { describe, it, expect } from "vitest";
import {
  FRANCE_DEPARTEMENTS,
  deptCodeFromCodePostal,
  getDeptByCode,
  getDeptName,
} from "@/lib/geo/france-departements";

describe("FRANCE_DEPARTEMENTS — invariants référentiel", () => {
  it("contient 96 départements (95 numériques + 2A/2B Corse)", () => {
    expect(FRANCE_DEPARTEMENTS).toHaveLength(96);
  });

  it("tous les codes sont uniques", () => {
    const codes = FRANCE_DEPARTEMENTS.map((d) => d.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("toutes les positions (col, row) sont uniques (pas de superposition hexgrid)", () => {
    const keys = FRANCE_DEPARTEMENTS.map((d) => `${d.col},${d.row}`);
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dupes).toEqual([]);
  });

  it("inclut les 8 départements clés du Grand Ouest (cœur cible TerrOir)", () => {
    const codes = new Set(FRANCE_DEPARTEMENTS.map((d) => d.code));
    expect(codes.has("72")).toBe(true); // Sarthe
    expect(codes.has("49")).toBe(true); // Maine-et-Loire
    expect(codes.has("53")).toBe(true); // Mayenne
    expect(codes.has("61")).toBe(true); // Orne
    expect(codes.has("44")).toBe(true); // Loire-Atlantique
    expect(codes.has("85")).toBe(true); // Vendée
    expect(codes.has("35")).toBe(true); // Ille-et-Vilaine
    expect(codes.has("28")).toBe(true); // Eure-et-Loir
  });

  it("inclut Corse (2A et 2B) avec positions distinctes", () => {
    const corse2A = FRANCE_DEPARTEMENTS.find((d) => d.code === "2A");
    const corse2B = FRANCE_DEPARTEMENTS.find((d) => d.code === "2B");
    expect(corse2A).toBeTruthy();
    expect(corse2B).toBeTruthy();
    expect(`${corse2A!.col},${corse2A!.row}`).not.toBe(
      `${corse2B!.col},${corse2B!.row}`,
    );
  });

  it("getDeptByCode retourne le département pour un code valide, undefined sinon", () => {
    expect(getDeptByCode("72")?.name).toBe("Sarthe");
    expect(getDeptByCode("99")).toBeUndefined();
  });

  it("getDeptName retourne le nom ou le code en fallback", () => {
    expect(getDeptName("72")).toBe("Sarthe");
    expect(getDeptName("99")).toBe("99");
  });
});

describe("deptCodeFromCodePostal", () => {
  it("code postal métropole 5 chiffres → 2 premiers", () => {
    expect(deptCodeFromCodePostal("72100")).toBe("72");
    expect(deptCodeFromCodePostal("49000")).toBe("49");
    expect(deptCodeFromCodePostal("75008")).toBe("75");
  });

  it("Corse : 200xx → 2A", () => {
    expect(deptCodeFromCodePostal("20000")).toBe("2A");
    expect(deptCodeFromCodePostal("20090")).toBe("2A");
  });

  it("Corse : 201xx → 2A", () => {
    expect(deptCodeFromCodePostal("20100")).toBe("2A");
    expect(deptCodeFromCodePostal("20167")).toBe("2A");
  });

  it("Corse : 202xx-206xx → 2B", () => {
    expect(deptCodeFromCodePostal("20200")).toBe("2B");
    expect(deptCodeFromCodePostal("20620")).toBe("2B");
  });

  it("DOM 97x/98x → 3 premiers chiffres (hors hexgrid métropole)", () => {
    expect(deptCodeFromCodePostal("97400")).toBe("974");
    expect(deptCodeFromCodePostal("97150")).toBe("971");
    expect(deptCodeFromCodePostal("98800")).toBe("988");
  });

  it("trim espaces", () => {
    expect(deptCodeFromCodePostal(" 72100 ")).toBe("72");
  });

  it("null / undefined / vide → null", () => {
    expect(deptCodeFromCodePostal(null)).toBeNull();
    expect(deptCodeFromCodePostal(undefined)).toBeNull();
    expect(deptCodeFromCodePostal("")).toBeNull();
    expect(deptCodeFromCodePostal(" ")).toBeNull();
  });

  it("string trop court → null", () => {
    expect(deptCodeFromCodePostal("7")).toBeNull();
  });
});
