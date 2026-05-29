import { describe, it, expect } from "vitest";
import {
  formatSlotTime,
  formatSlotRange,
  formatSlotDateTime,
  extractDateRetrait,
  extractHeureRetrait,
  formatLegacyTimeHHMM,
} from "@/lib/slots/format-slot-time";

// Date de référence : samedi 25 avril 2026, 09:30 Paris (CEST UTC+2)
// = 07:30 UTC. Avril est en heure d'été côté France.
const SAT_25_APR_0930_ISO = "2026-04-25T07:30:00.000Z";
const SAT_25_APR_1000_ISO = "2026-04-25T08:00:00.000Z";

// Date en hiver : vendredi 5 janvier 2026, 09:00 Paris (CET UTC+1)
// = 08:00 UTC.
const WINTER_ISO = "2026-01-05T08:00:00.000Z";

describe("formatSlotTime", () => {
  it("ISO → 9h30 (minutes non nulles)", () => {
    expect(formatSlotTime(SAT_25_APR_0930_ISO)).toBe("9h30");
  });

  it("ISO → 10h (heure pile)", () => {
    expect(formatSlotTime(SAT_25_APR_1000_ISO)).toBe("10h");
  });

  it("applique bien la zone Europe/Paris en hiver (CET)", () => {
    expect(formatSlotTime(WINTER_ISO)).toBe("9h");
  });
});

describe("formatSlotRange", () => {
  it("9h30–10h", () => {
    expect(formatSlotRange(SAT_25_APR_0930_ISO, SAT_25_APR_1000_ISO)).toBe(
      "9h30–10h",
    );
  });
});

describe("formatSlotDateTime", () => {
  it('samedi 25 avril à 9h30 avec capitalisation FR', () => {
    expect(formatSlotDateTime(SAT_25_APR_0930_ISO)).toBe(
      "Samedi 25 avril à 9h30",
    );
  });
});

describe("extractHeureRetrait", () => {
  it("ISO UTC → time SQL HH:MM:00 en heure Paris", () => {
    expect(extractHeureRetrait(SAT_25_APR_0930_ISO)).toBe("09:30:00");
  });

  it("zéro-padding minutes pile", () => {
    expect(extractHeureRetrait(SAT_25_APR_1000_ISO)).toBe("10:00:00");
  });
});

describe("extractDateRetrait", () => {
  it("ISO UTC -> date SQL YYYY-MM-DD en heure Paris", () => {
    expect(extractDateRetrait(SAT_25_APR_0930_ISO)).toBe("2026-04-25");
  });

  it("respecte le passage de jour Europe/Paris", () => {
    expect(extractDateRetrait("2026-04-24T22:30:00.000Z")).toBe(
      "2026-04-25",
    );
  });
});

describe("formatLegacyTimeHHMM", () => {
  it('"09:30:00" → "9h30"', () => {
    expect(formatLegacyTimeHHMM("09:30:00")).toBe("9h30");
  });

  it('"09:30" → "9h30"', () => {
    expect(formatLegacyTimeHHMM("09:30")).toBe("9h30");
  });

  it('"09:00:00" → "9h" (minutes pile)', () => {
    expect(formatLegacyTimeHHMM("09:00:00")).toBe("9h");
  });

  it("null → —", () => {
    expect(formatLegacyTimeHHMM(null)).toBe("—");
  });

  it('invalide → "—"', () => {
    expect(formatLegacyTimeHHMM("nope")).toBe("—");
  });
});
