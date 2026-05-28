import { describe, it, expect } from "vitest";
import {
  computeRevenueDelta,
  MIN_BASELINE_REVENUE_FOR_DELTA,
} from "@/lib/producers/compute-revenue-delta";

describe("computeRevenueDelta", () => {
  // Cas A — pas de donnée du tout
  it("retourne null quand revenueLastWeek = 0 et revenueWeek = 0", () => {
    expect(computeRevenueDelta(0, 0)).toBeNull();
  });

  // Cas B — baseline absent, semaine courante non vide
  it("retourne null quand revenueLastWeek = 0 et revenueWeek > 0 (pas de base de comparaison)", () => {
    expect(computeRevenueDelta(120, 0)).toBeNull();
  });

  // Cas C — vraie chute (baseline significatif → 0)
  it("retourne -100 quand revenueWeek = 0 et revenueLastWeek >= seuil", () => {
    expect(computeRevenueDelta(0, MIN_BASELINE_REVENUE_FOR_DELTA)).toBe(-100);
    expect(computeRevenueDelta(0, 120)).toBe(-100);
  });

  // Cas D — calcul normal arrondi
  it("calcule un delta positif arrondi", () => {
    // 150 vs 100 → +50%
    expect(computeRevenueDelta(150, 100)).toBe(50);
  });

  it("calcule un delta négatif arrondi", () => {
    // 80 vs 100 → -20%
    expect(computeRevenueDelta(80, 100)).toBe(-20);
  });

  it("retourne 0 quand revenueWeek = revenueLastWeek", () => {
    expect(computeRevenueDelta(50, 50)).toBe(0);
  });

  it("arrondit à l'entier le plus proche", () => {
    // 110 vs 100 → +10% exact
    expect(computeRevenueDelta(110, 100)).toBe(10);
    // 103 vs 100 → +3%
    expect(computeRevenueDelta(103, 100)).toBe(3);
    // 333.33 vs 100 → +233.33 → +233
    expect(computeRevenueDelta(333.33, 100)).toBe(233);
  });

  // Baseline trivial — coeur du fix (régression Chloé 2026-05-28)
  it("retourne null quand revenueLastWeek est sous le seuil (0,01 €)", () => {
    expect(computeRevenueDelta(0, 0.01)).toBeNull();
  });

  it("retourne null quand revenueLastWeek est sous le seuil (3 €)", () => {
    expect(computeRevenueDelta(0, 3)).toBeNull();
    expect(computeRevenueDelta(100, 3)).toBeNull();
  });

  it("retourne null juste sous le seuil (4,99 €)", () => {
    expect(computeRevenueDelta(0, 4.99)).toBeNull();
  });

  it("calcule normalement pile au seuil (5 €)", () => {
    // Pile au seuil = inclus, on calcule. 0 vs 5 → -100%.
    expect(computeRevenueDelta(0, 5)).toBe(-100);
  });

  it("MIN_BASELINE_REVENUE_FOR_DELTA vaut 5 (euros)", () => {
    expect(MIN_BASELINE_REVENUE_FOR_DELTA).toBe(5);
  });
});
