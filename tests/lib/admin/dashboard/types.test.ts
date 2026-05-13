import { describe, it, expect } from "vitest";
import { centsToEuro } from "@/lib/admin/dashboard/types";

describe("centsToEuro", () => {
  it("convertit 12500 cents en 125 euros", () => {
    expect(centsToEuro(12500)).toBe(125);
  });

  it("préserve les fractions de cent (round = à la charge de l'appelant)", () => {
    expect(centsToEuro(12399)).toBe(123.99);
  });

  it("gère 0", () => {
    expect(centsToEuro(0)).toBe(0);
  });
});
