import { describe, it, expect } from "vitest";
import {
  COOKIE_CONSENT_NAME,
  COOKIE_CONSENT_VERSION,
  DEFAULT_CONSENT,
  acceptAllConsent,
  buildConsent,
  hasMadeChoice,
  parseConsent,
  rejectAllConsent,
  serializeConsent,
} from "@/lib/rgpd/cookie-consent";

const FIXED_NOW = new Date("2026-05-10T12:00:00.000Z");

describe("parseConsent", () => {
  it("retourne defaults si raw est null/undefined/vide", () => {
    expect(parseConsent(null)).toEqual(DEFAULT_CONSENT);
    expect(parseConsent(undefined)).toEqual(DEFAULT_CONSENT);
    expect(parseConsent("")).toEqual(DEFAULT_CONSENT);
  });

  it("retourne defaults sur JSON corrompu", () => {
    expect(parseConsent("not-a-json")).toEqual(DEFAULT_CONSENT);
    expect(parseConsent("{broken")).toEqual(DEFAULT_CONSENT);
  });

  it("retourne defaults sur version inconnue", () => {
    const raw = encodeURIComponent(
      JSON.stringify({
        v: "999",
        essentials: true,
        analytics: true,
        marketing: true,
        updated_at: "2026-05-10T12:00:00.000Z",
      }),
    );
    expect(parseConsent(raw)).toEqual(DEFAULT_CONSENT);
  });

  it("force essentials=true même si payload tente false (non-désactivable)", () => {
    const raw = encodeURIComponent(
      JSON.stringify({
        v: COOKIE_CONSENT_VERSION,
        essentials: false,
        analytics: false,
        marketing: false,
        updated_at: "2026-05-10T12:00:00.000Z",
      }),
    );
    const result = parseConsent(raw);
    expect(result.essentials).toBe(true);
  });

  it("parse un consent valide rond-trip avec serializeConsent", () => {
    const original = buildConsent({ analytics: true, marketing: false }, FIXED_NOW);
    const raw = serializeConsent(original);
    expect(parseConsent(raw)).toEqual(original);
  });

  it("coerce analytics/marketing en boolean strict (truthy non-true → false)", () => {
    const raw = encodeURIComponent(
      JSON.stringify({
        v: COOKIE_CONSENT_VERSION,
        analytics: "yes", // truthy mais pas true
        marketing: 1,
        updated_at: "2026-05-10T12:00:00.000Z",
      }),
    );
    const result = parseConsent(raw);
    expect(result.analytics).toBe(false);
    expect(result.marketing).toBe(false);
  });

  it("retourne defaults sur URL encoding cassé", () => {
    // %ZZ est un encoding invalide → decodeURIComponent throw.
    expect(parseConsent("%ZZ")).toEqual(DEFAULT_CONSENT);
  });
});

describe("buildConsent / acceptAllConsent / rejectAllConsent", () => {
  it("buildConsent applique les flags + force essentials=true + updated_at", () => {
    const c = buildConsent({ analytics: true, marketing: false }, FIXED_NOW);
    expect(c).toEqual({
      v: COOKIE_CONSENT_VERSION,
      essentials: true,
      analytics: true,
      marketing: false,
      updated_at: FIXED_NOW.toISOString(),
    });
  });

  it("buildConsent sans flag analytics/marketing → false par défaut", () => {
    const c = buildConsent({}, FIXED_NOW);
    expect(c.analytics).toBe(false);
    expect(c.marketing).toBe(false);
  });

  it("acceptAllConsent active analytics + marketing", () => {
    const c = acceptAllConsent(FIXED_NOW);
    expect(c.analytics).toBe(true);
    expect(c.marketing).toBe(true);
  });

  it("rejectAllConsent désactive analytics + marketing (essentials reste true)", () => {
    const c = rejectAllConsent(FIXED_NOW);
    expect(c.essentials).toBe(true);
    expect(c.analytics).toBe(false);
    expect(c.marketing).toBe(false);
  });
});

describe("hasMadeChoice", () => {
  it("false sur le DEFAULT_CONSENT (epoch updated_at)", () => {
    expect(hasMadeChoice(DEFAULT_CONSENT)).toBe(false);
  });

  it("true dès qu'un consent valide a été construit", () => {
    expect(hasMadeChoice(acceptAllConsent(FIXED_NOW))).toBe(true);
    expect(hasMadeChoice(rejectAllConsent(FIXED_NOW))).toBe(true);
    expect(
      hasMadeChoice(buildConsent({ analytics: false }, FIXED_NOW)),
    ).toBe(true);
  });
});

describe("serializeConsent", () => {
  it("produit une string URL-safe parsable", () => {
    const c = acceptAllConsent(FIXED_NOW);
    const raw = serializeConsent(c);
    expect(raw).not.toContain(" ");
    expect(decodeURIComponent(raw)).toContain('"v":"1"');
  });
});

describe("COOKIE_CONSENT_NAME", () => {
  it("est aligné sur la constante exposée publique", () => {
    expect(COOKIE_CONSENT_NAME).toBe("terroir-cookie-consent");
  });
});
