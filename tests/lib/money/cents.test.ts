import { describe, it, expect } from "vitest";
import { eurosToCents, centsToEuros, sumCents } from "@/lib/money/cents";

describe("cents helpers — T-415", () => {
  describe("eurosToCents", () => {
    it("1 — number 15.00 → 1500", () => {
      expect(eurosToCents(15.0)).toBe(1500);
    });

    it("2 — string '15.00' (DB numeric) → 1500", () => {
      expect(eurosToCents("15.00")).toBe(1500);
    });

    it("3 — 0.30 → 30 (anti-IEEE 754 drift)", () => {
      expect(eurosToCents(0.3)).toBe(30);
    });
  });

  describe("centsToEuros", () => {
    it("4 — 1500 → 15.00", () => {
      expect(centsToEuros(1500)).toBe(15.0);
    });
  });

  describe("sumCents", () => {
    it("5 — sum strings ['10.00', '20.00', '30.00'] → 6000", () => {
      expect(sumCents(["10.00", "20.00", "30.00"])).toBe(6000);
    });

    it("6 — sum 100 × 0.30 → 3000 (anti-float drift)", () => {
      const values = Array(100).fill("0.30");
      expect(sumCents(values)).toBe(3000);
    });
  });
});
