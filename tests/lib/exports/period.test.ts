import { describe, it, expect } from "vitest";
import { parsePeriodParams, formatPeriodForFilename } from "@/lib/exports/period";

describe("parsePeriodParams", () => {
  it("rejette si from manquant", () => {
    const r = parsePeriodParams({ from: null, to: "2026-01-01" });
    expect(r.ok).toBe(false);
  });

  it("rejette si to manquant", () => {
    const r = parsePeriodParams({ from: "2026-01-01", to: null });
    expect(r.ok).toBe(false);
  });

  it("rejette format invalide", () => {
    const r1 = parsePeriodParams({ from: "01/01/2026", to: "2026-01-01" });
    expect(r1.ok).toBe(false);
    const r2 = parsePeriodParams({ from: "2026-01-01", to: "2026-13-01" });
    // 13ème mois → Date.parse renvoie NaN, on rejette
    expect(r2.ok).toBe(false);
  });

  it("rejette si from > to", () => {
    const r = parsePeriodParams({ from: "2026-12-31", to: "2026-01-01" });
    expect(r.ok).toBe(false);
  });

  it("rejette si période > 366 jours", () => {
    const r = parsePeriodParams({ from: "2024-01-01", to: "2026-12-31" });
    expect(r.ok).toBe(false);
  });

  it("accepte from = to (1 jour)", () => {
    const r = parsePeriodParams({ from: "2026-05-07", to: "2026-05-07" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.period.fromIso).toBe("2026-05-07T00:00:00.000Z");
      expect(r.period.toEndOfDayIso).toBe("2026-05-07T23:59:59.999Z");
    }
  });

  it("accepte une période d'1 an", () => {
    const r = parsePeriodParams({ from: "2026-01-01", to: "2026-12-31" });
    expect(r.ok).toBe(true);
  });
});

describe("formatPeriodForFilename", () => {
  it("concatène from_to avec underscore", () => {
    expect(
      formatPeriodForFilename({ from: "2026-01-01", to: "2026-12-31" }),
    ).toBe("2026-01-01_2026-12-31");
  });
});
