import { describe, it, expect } from "vitest";

import { buildExportFilename } from "@/lib/audit-logs/export-filename";

describe("buildExportFilename", () => {
  it("été — UTC 12:32 = Paris 14:32 (UTC+2 DST)", () => {
    const utc = new Date("2026-04-30T12:32:00Z");
    expect(buildExportFilename(utc, false)).toBe(
      "audit-logs_2026-04-30_1432.csv",
    );
  });

  it("hiver — UTC 12:32 = Paris 13:32 (UTC+1)", () => {
    const utc = new Date("2026-12-15T12:32:00Z");
    expect(buildExportFilename(utc, false)).toBe(
      "audit-logs_2026-12-15_1332.csv",
    );
  });

  it("ajoute le suffixe _filtered quand hasFilters=true", () => {
    const utc = new Date("2026-04-30T12:32:00Z");
    expect(buildExportFilename(utc, true)).toBe(
      "audit-logs_2026-04-30_1432_filtered.csv",
    );
  });

  it("change de jour calendaire à minuit Paris (UTC 22:00 été = 00:00 J+1 Paris)", () => {
    const utc = new Date("2026-04-29T22:30:00Z");
    expect(buildExportFilename(utc, false)).toBe(
      "audit-logs_2026-04-30_0030.csv",
    );
  });

  it("transition spring forward — 29/03/2026 02:00 Paris saute à 03:00 (UTC+1 → UTC+2)", () => {
    // 2026-03-29T01:30:00Z = 2026-03-29T02:30 Paris si UTC+1, mais à
    // cet instant l'heure d'été est déjà active → 03:30 Paris.
    const utc = new Date("2026-03-29T01:30:00Z");
    expect(buildExportFilename(utc, false)).toBe(
      "audit-logs_2026-03-29_0330.csv",
    );
  });

  it("transition fall back — 25/10/2026 03:00 Paris revient à 02:00 (UTC+2 → UTC+1)", () => {
    // Le saut a lieu à 01:00:00Z (= 03:00 Paris UTC+2 → 02:00 Paris UTC+1).
    // À 01:30Z on est déjà repassé en UTC+1 → Paris affiche 02:30.
    const utc = new Date("2026-10-25T01:30:00Z");
    expect(buildExportFilename(utc, false)).toBe(
      "audit-logs_2026-10-25_0230.csv",
    );
  });

  it("avant le fall back — 25/10/2026 00:30Z = 02:30 Paris (UTC+2 encore)", () => {
    const utc = new Date("2026-10-25T00:30:00Z");
    expect(buildExportFilename(utc, false)).toBe(
      "audit-logs_2026-10-25_0230.csv",
    );
  });

  it("padding 2 digits sur mois/jour/heure/minute", () => {
    const utc = new Date("2026-01-05T03:05:00Z");
    expect(buildExportFilename(utc, false)).toBe(
      "audit-logs_2026-01-05_0405.csv",
    );
  });
});
