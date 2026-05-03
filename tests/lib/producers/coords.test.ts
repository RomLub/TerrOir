import { describe, it, expect } from "vitest";
import { roundCoord } from "@/lib/producers/coords";

describe("roundCoord", () => {
  it("arrondit une latitude positive à 2 décimales", () => {
    expect(roundCoord(47.98765)).toBe(47.99);
  });

  it("arrondit une latitude négative à 2 décimales", () => {
    expect(roundCoord(-12.34567)).toBe(-12.35);
  });

  it("arrondit une longitude positive à 2 décimales", () => {
    expect(roundCoord(0.12345)).toBe(0.12);
  });

  it("arrondit une longitude négative à 2 décimales", () => {
    expect(roundCoord(-3.6789)).toBe(-3.68);
  });

  it("retourne null pour null", () => {
    expect(roundCoord(null)).toBeNull();
  });

  it("retourne null pour NaN", () => {
    expect(roundCoord(Number.NaN)).toBeNull();
  });

  it("retourne null pour Infinity", () => {
    expect(roundCoord(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("retourne null pour -Infinity", () => {
    expect(roundCoord(Number.NEGATIVE_INFINITY)).toBeNull();
  });

  it("est idempotent sur une valeur déjà à 2 décimales", () => {
    expect(roundCoord(47.99)).toBe(47.99);
    expect(roundCoord(-3.68)).toBe(-3.68);
    expect(roundCoord(0)).toBe(0);
  });

  it("préserve un nombre entier (zéro décimale)", () => {
    expect(roundCoord(48)).toBe(48);
    expect(roundCoord(-1)).toBe(-1);
  });
});
