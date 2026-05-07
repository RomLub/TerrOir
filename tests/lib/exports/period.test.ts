import { describe, it, expect } from "vitest";
import {
  parsePeriodParams,
  formatPeriodForFilename,
  formatDateInExportTimezone,
} from "@/lib/exports/period";

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
    // 13ème mois → format regex rejette en amont du parse Date.
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
  });

  it("accepte une période d'1 an", () => {
    const r = parsePeriodParams({ from: "2026-01-01", to: "2026-12-31" });
    expect(r.ok).toBe(true);
  });

  // bugs-P1-2 : tests timezone Europe/Paris.
  describe("timezone Europe/Paris (bugs-P1-2)", () => {
    it("from 00:00:00 Europe/Paris → UTC en heure d'été DST (CEST = UTC+2)", () => {
      // 7 mai 2026 = heure d'été (DST actif fin mars → fin octobre).
      // 00:00:00 Paris = 22:00:00 UTC la veille.
      const r = parsePeriodParams({ from: "2026-05-07", to: "2026-05-07" });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.period.fromIso).toBe("2026-05-06T22:00:00.000Z");
        expect(r.period.toEndOfDayIso).toBe("2026-05-07T21:59:59.999Z");
      }
    });

    it("from 00:00:00 Europe/Paris → UTC en heure d'hiver (CET = UTC+1)", () => {
      // 15 janvier 2026 = heure d'hiver. 00:00:00 Paris = 23:00:00 UTC la veille.
      const r = parsePeriodParams({ from: "2026-01-15", to: "2026-01-15" });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.period.fromIso).toBe("2026-01-14T23:00:00.000Z");
        expect(r.period.toEndOfDayIso).toBe("2026-01-15T22:59:59.999Z");
      }
    });

    it("période sur le passage à l'heure d'été (29 mars 2026)", () => {
      // DST 2026 = dimanche 29 mars 02:00 (CET) → 03:00 (CEST).
      // from 28 mars : 00:00 Paris (CET) = 23:00 UTC le 27 mars.
      // to 30 mars : 23:59:59.999 Paris (CEST) = 21:59:59.999 UTC le 30.
      const r = parsePeriodParams({ from: "2026-03-28", to: "2026-03-30" });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.period.fromIso).toBe("2026-03-27T23:00:00.000Z");
        expect(r.period.toEndOfDayIso).toBe("2026-03-30T21:59:59.999Z");
      }
    });

    it("commande à 00:30 Paris doit tomber dans la journée du 7 mai (pas du 6)", () => {
      // Cas critique DGCCRF : commande validée à 00:30 Paris le 7 mai
      // → timestamp UTC = "2026-05-06T22:30:00.000Z" (UTC+2 en CEST).
      // L'export filtré sur "from=2026-05-07&to=2026-05-07" doit l'inclure.
      const r = parsePeriodParams({ from: "2026-05-07", to: "2026-05-07" });
      expect(r.ok).toBe(true);
      if (r.ok) {
        const orderTimestampUtc = "2026-05-06T22:30:00.000Z"; // 00:30 Paris le 7
        expect(orderTimestampUtc >= r.period.fromIso).toBe(true);
        expect(orderTimestampUtc <= r.period.toEndOfDayIso).toBe(true);
      }
    });

    it("commande à 23:30 UTC le 6 mai NE doit PAS tomber dans le 6 mai si TZ Paris", () => {
      // 23:30 UTC le 6 mai = 01:30 Paris le 7 mai (CEST).
      // L'export "from=2026-05-06&to=2026-05-06" ne doit PAS inclure cette commande.
      const r = parsePeriodParams({ from: "2026-05-06", to: "2026-05-06" });
      expect(r.ok).toBe(true);
      if (r.ok) {
        const orderTimestampUtc = "2026-05-06T23:30:00.000Z";
        expect(orderTimestampUtc <= r.period.toEndOfDayIso).toBe(false);
      }
    });
  });
});

describe("formatPeriodForFilename", () => {
  it("concatène from_to avec underscore", () => {
    expect(
      formatPeriodForFilename({ from: "2026-01-01", to: "2026-12-31" }),
    ).toBe("2026-01-01_2026-12-31");
  });
});

describe("formatDateInExportTimezone (bugs-P1-2)", () => {
  it("retourne chaîne vide pour null", () => {
    expect(formatDateInExportTimezone(null)).toBe("");
  });

  it("affiche la date locale Paris (CEST) pour une commande à 00:30 Paris le 7 mai", () => {
    // 2026-05-06T22:30:00.000Z = 00:30 Paris le 7 mai (CEST = UTC+2).
    expect(formatDateInExportTimezone("2026-05-06T22:30:00.000Z")).toBe(
      "2026-05-07",
    );
  });

  it("affiche la date locale Paris (CET) pour une commande à 00:30 Paris le 15 janvier", () => {
    // 2026-01-14T23:30:00.000Z = 00:30 Paris le 15 janvier (CET = UTC+1).
    expect(formatDateInExportTimezone("2026-01-14T23:30:00.000Z")).toBe(
      "2026-01-15",
    );
  });

  it("anti-régression : affiche en Paris pas en UTC", () => {
    // Avant bugs-P1-2 : `slice(0, 10)` aurait renvoyé "2026-05-06" pour ce
    // timestamp UTC. Désormais, on affiche la date locale Paris = "2026-05-07".
    expect(formatDateInExportTimezone("2026-05-06T22:30:00.000Z")).not.toBe(
      "2026-05-06",
    );
  });
});
