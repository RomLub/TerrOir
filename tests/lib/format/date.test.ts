import { describe, it, expect } from "vitest";
import { formatDateFr } from "@/lib/format/date";

// `formatDateFr` s'appuie sur Intl (toLocaleDateString 'fr-FR'). Sur Node 20+
// avec ICU full, le format 'short' inclut un point final ("avr."). Les tests
// ci-dessous assument cette sortie — si ICU change, ajuster les expected.

describe("formatDateFr — date-only (YYYY-MM-DD)", () => {
  it("23 avr. 2026 avec année par défaut", () => {
    expect(formatDateFr("2026-04-23")).toBe("23 avr. 2026");
  });

  it("opts.year: false → sans année", () => {
    expect(formatDateFr("2026-04-23", { year: false })).toBe("23 avr.");
  });

  it("opts.year: true (explicite) → avec année", () => {
    expect(formatDateFr("2026-04-23", { year: true })).toBe("23 avr. 2026");
  });

  it("YYYY-MM-DD parsé en local midnight : pas de shift UTC (01 jan reste 01)", () => {
    // Défense historique : sans normalisation, `new Date('2026-01-01')` est
    // minuit UTC → 00:00 UTC = 01:00 Paris (CET) le 1er ; mais certains TZ
    // (ouest) afficheraient le 31/12. La normalisation `T00:00:00` (local)
    // garantit que le jour affiché reste "01" quelle que soit la TZ.
    expect(formatDateFr("2026-01-01")).toBe("01 janv. 2026");
  });
});

describe("formatDateFr — ISO timestamp", () => {
  it("ISO avec heure → format date", () => {
    // Midi UTC = 14:00 Paris (CEST) → jour 23 en France
    expect(formatDateFr("2026-04-23T12:00:00.000Z")).toBe("23 avr. 2026");
  });
});

describe("formatDateFr — entrées invalides / vides", () => {
  it("null → —", () => {
    expect(formatDateFr(null)).toBe("—");
  });

  it("undefined → —", () => {
    expect(formatDateFr(undefined)).toBe("—");
  });

  it("chaîne vide → —", () => {
    // "" est falsy → early return "—" (avant tentative de parse)
    expect(formatDateFr("")).toBe("—");
  });

  it("chaîne non-parsable → retourne l'input original", () => {
    expect(formatDateFr("not-a-date")).toBe("not-a-date");
  });
});
