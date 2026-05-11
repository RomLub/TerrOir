import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  generateOptOutToken,
  verifyOptOutToken,
} from "@/lib/rgpd/opt-out-token";

// `getSecret()` lit process.env.OPT_OUT_TOKEN_SECRET à chaque appel, donc
// muter la variable au runtime suffit (pas besoin de vi.resetModules).
const ORIGINAL_SECRET = process.env.OPT_OUT_TOKEN_SECRET;

function setSecret(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.OPT_OUT_TOKEN_SECRET;
  } else {
    process.env.OPT_OUT_TOKEN_SECRET = value;
  }
}

beforeEach(() => {
  setSecret("test-secret-opt-out-unit");
});

afterEach(() => {
  setSecret(ORIGINAL_SECRET);
});

const FIXED_NOW = Date.UTC(2026, 4, 10, 12, 0, 0); // 2026-05-10T12:00:00Z
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

describe("generateOptOutToken — F-027 (HMAC + TTL 30j)", () => {
  it("retourne { token, expiresAt } avec expiresAt = now + 30j", () => {
    const result = generateOptOutToken("user@example.com", FIXED_NOW);
    expect(result.expiresAt.getTime()).toBe(FIXED_NOW + THIRTY_DAYS_MS);
    // Format `<expiresAtMs>.<hex32>`
    expect(result.token).toMatch(/^\d{10,16}\.[0-9a-f]{32}$/);
    const [tsPart] = result.token.split(".");
    expect(Number(tsPart)).toBe(FIXED_NOW + THIRTY_DAYS_MS);
  });

  it("email normalisé (casse + espaces) produit le même HMAC à expiresAt fixé", () => {
    const a = generateOptOutToken("user@example.com", FIXED_NOW);
    const b = generateOptOutToken("USER@EXAMPLE.COM", FIXED_NOW);
    const c = generateOptOutToken("  User@Example.com  ", FIXED_NOW);
    expect(a.token).toBe(b.token);
    expect(a.token).toBe(c.token);
  });

  it("déterministe : deux appels avec même input + nowMs → même token", () => {
    const a = generateOptOutToken("user@example.com", FIXED_NOW);
    const b = generateOptOutToken("user@example.com", FIXED_NOW);
    expect(a.token).toBe(b.token);
  });

  it("secrets différents → tokens différents pour le même email/now", () => {
    setSecret("secret-A");
    const a = generateOptOutToken("user@example.com", FIXED_NOW);
    setSecret("secret-B");
    const b = generateOptOutToken("user@example.com", FIXED_NOW);
    expect(a.token).not.toBe(b.token);
  });

  it("throw si OPT_OUT_TOKEN_SECRET est absent", () => {
    setSecret(undefined);
    expect(() => generateOptOutToken("user@example.com")).toThrow(
      /OPT_OUT_TOKEN_SECRET/,
    );
  });
});

describe("verifyOptOutToken — F-027 (valid/expired/invalid)", () => {
  it("accepte un token fraîchement généré (valid=true, expired=undef)", () => {
    const { token, expiresAt } = generateOptOutToken(
      "user@example.com",
      FIXED_NOW,
    );
    const result = verifyOptOutToken("user@example.com", token, FIXED_NOW);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.email).toBe("user@example.com");
      expect(result.expiresAt.getTime()).toBe(expiresAt.getTime());
    }
  });

  it("accepte après normalisation casse/espaces côté vérif", () => {
    const { token } = generateOptOutToken("user@example.com", FIXED_NOW);
    expect(
      verifyOptOutToken("USER@EXAMPLE.COM", token, FIXED_NOW).valid,
    ).toBe(true);
    expect(
      verifyOptOutToken("  user@example.com  ", token, FIXED_NOW).valid,
    ).toBe(true);
  });

  it("rejette pour un autre email (expired=false, juste invalide)", () => {
    const { token } = generateOptOutToken("alice@example.com", FIXED_NOW);
    const result = verifyOptOutToken("bob@example.com", token, FIXED_NOW);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.expired).toBe(false);
    }
  });

  it("rejette quand TTL dépassé : expired=true", () => {
    const { token } = generateOptOutToken("user@example.com", FIXED_NOW);
    // 31 jours après émission
    const later = FIXED_NOW + 31 * 24 * 60 * 60 * 1000;
    const result = verifyOptOutToken("user@example.com", token, later);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.expired).toBe(true);
    }
  });

  it("rejette tout pile au moment de l'expiration (ts <= now → expired)", () => {
    const { token } = generateOptOutToken("user@example.com", FIXED_NOW);
    // expiresAtMs = FIXED_NOW + 30j ; pile à expiresAtMs : expired
    const atExpiry = FIXED_NOW + THIRTY_DAYS_MS;
    const result = verifyOptOutToken("user@example.com", token, atExpiry);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.expired).toBe(true);
    }
  });

  it("rejette format sans séparateur '.' (invalid, expired=false)", () => {
    const result = verifyOptOutToken(
      "user@example.com",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      FIXED_NOW,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.expired).toBe(false);
  });

  it("rejette ts non-numérique", () => {
    const result = verifyOptOutToken(
      "user@example.com",
      `abc.${"a".repeat(32)}`,
      FIXED_NOW,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.expired).toBe(false);
  });

  it("rejette hex part de longueur ≠ 32", () => {
    const result = verifyOptOutToken(
      "user@example.com",
      `${FIXED_NOW + THIRTY_DAYS_MS}.${"a".repeat(31)}`,
      FIXED_NOW,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.expired).toBe(false);
  });

  it("rejette hex part contenant des caractères non-hex", () => {
    const result = verifyOptOutToken(
      "user@example.com",
      `${FIXED_NOW + THIRTY_DAYS_MS}.${"Z".repeat(32)}`,
      FIXED_NOW,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.expired).toBe(false);
  });

  it("rejette un token vide", () => {
    const result = verifyOptOutToken("user@example.com", "", FIXED_NOW);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.expired).toBe(false);
  });

  it("rejette un token non-string (robustesse runtime)", () => {
    expect(
      verifyOptOutToken(
        "user@example.com",
        null as unknown as string,
        FIXED_NOW,
      ).valid,
    ).toBe(false);
    expect(
      verifyOptOutToken(
        "user@example.com",
        123 as unknown as string,
        FIXED_NOW,
      ).valid,
    ).toBe(false);
  });

  it("rejette HMAC altéré (bit flip 1er char hex)", () => {
    const { token } = generateOptOutToken("user@example.com", FIXED_NOW);
    const dot = token.indexOf(".");
    const ts = token.slice(0, dot);
    const hex = token.slice(dot + 1);
    const flipped =
      ts + "." + (hex[0] === "0" ? "1" : "0") + hex.slice(1);
    const result = verifyOptOutToken(
      "user@example.com",
      flipped,
      FIXED_NOW,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.expired).toBe(false);
  });

  it("rejette HMAC valide mais expiresAtMs forgé (ne match plus le HMAC)", () => {
    const { token } = generateOptOutToken("user@example.com", FIXED_NOW);
    const dot = token.indexOf(".");
    const hex = token.slice(dot + 1);
    // ts forgé : un attaquant essaie de prolonger la TTL
    const forged = `${FIXED_NOW + 999_999_999_999}.${hex}`;
    const result = verifyOptOutToken(
      "user@example.com",
      forged,
      FIXED_NOW,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.expired).toBe(false);
  });

  it("throw si OPT_OUT_TOKEN_SECRET absent (propagation via verify)", () => {
    const { token } = generateOptOutToken("user@example.com", FIXED_NOW);
    setSecret(undefined);
    expect(() =>
      verifyOptOutToken("user@example.com", token, FIXED_NOW),
    ).toThrow(/OPT_OUT_TOKEN_SECRET/);
  });
});
