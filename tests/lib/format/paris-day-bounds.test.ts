import { describe, it, expect } from "vitest";

import {
  parisCalendarDayStartUtc,
  parisCalendarDayBoundsUtc,
} from "@/lib/format/paris-day-bounds";

describe("parisCalendarDayStartUtc", () => {
  it("été (DST actif, UTC+2) — 2026-04-30 → 2026-04-29T22:00:00Z", () => {
    expect(parisCalendarDayStartUtc("2026-04-30").toISOString()).toBe(
      "2026-04-29T22:00:00.000Z",
    );
  });

  it("hiver (DST inactif, UTC+1) — 2026-12-15 → 2026-12-14T23:00:00Z", () => {
    expect(parisCalendarDayStartUtc("2026-12-15").toISOString()).toBe(
      "2026-12-14T23:00:00.000Z",
    );
  });

  it("transition spring forward (dernier dim mars 2026 = 29/03) → début de jour Paris en heure d'hiver UTC+1", () => {
    // 2026-03-29 00:00 Paris est avant le saut (qui a lieu à 02:00 → 03:00).
    // Donc UTC = 2026-03-28T23:00:00Z (Paris encore UTC+1).
    expect(parisCalendarDayStartUtc("2026-03-29").toISOString()).toBe(
      "2026-03-28T23:00:00.000Z",
    );
  });

  it("lendemain spring forward (30/03) → UTC+2 (été)", () => {
    expect(parisCalendarDayStartUtc("2026-03-30").toISOString()).toBe(
      "2026-03-29T22:00:00.000Z",
    );
  });

  it("transition fall back (dernier dim oct 2026 = 25/10) → début de jour Paris en heure d'été UTC+2", () => {
    // 2026-10-25 00:00 Paris est avant le retour (qui a lieu à 03:00 → 02:00).
    // Donc UTC = 2026-10-24T22:00:00Z (Paris encore UTC+2).
    expect(parisCalendarDayStartUtc("2026-10-25").toISOString()).toBe(
      "2026-10-24T22:00:00.000Z",
    );
  });

  it("lendemain fall back (26/10) → UTC+1 (hiver)", () => {
    expect(parisCalendarDayStartUtc("2026-10-26").toISOString()).toBe(
      "2026-10-25T23:00:00.000Z",
    );
  });

  it("rejette un format invalide", () => {
    expect(() => parisCalendarDayStartUtc("30/04/2026")).toThrow();
    expect(() => parisCalendarDayStartUtc("2026-4-30")).toThrow();
    expect(() => parisCalendarDayStartUtc("")).toThrow();
  });
});

describe("parisCalendarDayBoundsUtc", () => {
  it("été : 24h pile (pas de transition DST dans le jour)", () => {
    const { startUtc, endUtc } = parisCalendarDayBoundsUtc("2026-04-30");
    expect(startUtc.toISOString()).toBe("2026-04-29T22:00:00.000Z");
    expect(endUtc.toISOString()).toBe("2026-04-30T22:00:00.000Z");
    expect(endUtc.getTime() - startUtc.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("hiver : 24h pile", () => {
    const { startUtc, endUtc } = parisCalendarDayBoundsUtc("2026-12-15");
    expect(startUtc.toISOString()).toBe("2026-12-14T23:00:00.000Z");
    expect(endUtc.toISOString()).toBe("2026-12-15T23:00:00.000Z");
    expect(endUtc.getTime() - startUtc.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("jour spring forward (29/03/2026) : 23h (perte d'une heure)", () => {
    const { startUtc, endUtc } = parisCalendarDayBoundsUtc("2026-03-29");
    expect(startUtc.toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(endUtc.toISOString()).toBe("2026-03-29T22:00:00.000Z");
    expect(endUtc.getTime() - startUtc.getTime()).toBe(23 * 60 * 60 * 1000);
  });

  it("jour fall back (25/10/2026) : 25h (gain d'une heure)", () => {
    const { startUtc, endUtc } = parisCalendarDayBoundsUtc("2026-10-25");
    expect(startUtc.toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(endUtc.toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect(endUtc.getTime() - startUtc.getTime()).toBe(25 * 60 * 60 * 1000);
  });
});
