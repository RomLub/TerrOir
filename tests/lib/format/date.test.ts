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

  it("YYYY-MM-DD : pas de shift TZ (01 jan reste 01 dans tous runtimes)", () => {
    // Anchor en UTC midnight + format Paris : projection 01:00 Paris
    // (hiver) ou 02:00 Paris (été), même jour calendaire que l'input,
    // peu importe la TZ runtime (Node UTC, browser Paris, browser
    // Tokyo/NY).
    expect(formatDateFr("2026-01-01")).toBe("01 janv. 2026");
  });
});

describe("formatDateFr — ISO timestamp", () => {
  it("ISO midi UTC en avril (été) → 14:00 Paris, jour identique", () => {
    expect(formatDateFr("2026-04-23T12:00:00.000Z")).toBe("23 avr. 2026");
  });

  it("DST été — boundary minuit Paris (2026-04-30T22:30Z = 2026-05-01T00:30 Paris UTC+2)", () => {
    // Le timestamp UTC est encore le 30 avril, mais en heure de Paris
    // c'est déjà le 1er mai → l'admin doit voir "01 mai".
    expect(formatDateFr("2026-04-30T22:30:00.000Z")).toBe("01 mai 2026");
  });

  it("DST hiver — boundary minuit Paris (2026-12-15T23:30Z = 2026-12-16T00:30 Paris UTC+1)", () => {
    expect(formatDateFr("2026-12-15T23:30:00.000Z")).toBe("16 déc. 2026");
  });

  it("Spring forward — 2026-03-29T01:30Z (Paris déjà UTC+2 = 03:30) reste sur le 29 mars", () => {
    expect(formatDateFr("2026-03-29T01:30:00.000Z")).toBe("29 mars 2026");
  });

  it("Fall back — 2026-10-25T00:30Z (Paris encore UTC+2 = 02:30) reste sur le 25 oct.", () => {
    expect(formatDateFr("2026-10-25T00:30:00.000Z")).toBe("25 oct. 2026");
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
