import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  generatePrefillToken,
  verifyPrefillToken,
} from "@/lib/leads/prefill-token";

// getSecret() lit process.env.LEAD_PREFILL_TOKEN_SECRET à chaque appel → on
// mute la variable au runtime (pas besoin de vi.resetModules).
const ORIGINAL_SECRET = process.env.LEAD_PREFILL_TOKEN_SECRET;

function setSecret(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.LEAD_PREFILL_TOKEN_SECRET;
  } else {
    process.env.LEAD_PREFILL_TOKEN_SECRET = value;
  }
}

beforeEach(() => {
  setSecret("test-secret-prefill-unit");
});

afterEach(() => {
  setSecret(ORIGINAL_SECRET);
});

const FIXED_NOW = Date.UTC(2026, 4, 22, 12, 0, 0); // 2026-05-22T12:00:00Z
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const LEAD_ID = "11111111-2222-4333-8444-555555555555";

describe("generatePrefillToken", () => {
  it("produit un token <uuid>.<ts>.<hex32> avec expiration +30j", () => {
    const { token, expiresAt } = generatePrefillToken(LEAD_ID, FIXED_NOW);
    const parts = token.split(".");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe(LEAD_ID);
    expect(parts[1]).toBe(String(FIXED_NOW + THIRTY_DAYS_MS));
    expect(parts[2]).toMatch(/^[0-9a-f]{32}$/);
    expect(expiresAt.getTime()).toBe(FIXED_NOW + THIRTY_DAYS_MS);
  });

  it("rejette un leadId non-UUID", () => {
    expect(() => generatePrefillToken("pas-un-uuid", FIXED_NOW)).toThrow(
      /UUID attendu/,
    );
  });

  it("throw si le secret est absent", () => {
    setSecret(undefined);
    expect(() => generatePrefillToken(LEAD_ID, FIXED_NOW)).toThrow(
      /LEAD_PREFILL_TOKEN_SECRET/,
    );
  });
});

describe("verifyPrefillToken", () => {
  it("valide un token fraîchement généré et restitue le leadId", () => {
    const { token } = generatePrefillToken(LEAD_ID, FIXED_NOW);
    const res = verifyPrefillToken(token, FIXED_NOW + 1000);
    expect(res.valid).toBe(true);
    if (res.valid) {
      expect(res.leadId).toBe(LEAD_ID);
      expect(res.expiresAt.getTime()).toBe(FIXED_NOW + THIRTY_DAYS_MS);
    }
  });

  it("rejette (expired) un token au-delà de 30 jours", () => {
    const { token } = generatePrefillToken(LEAD_ID, FIXED_NOW);
    const res = verifyPrefillToken(token, FIXED_NOW + THIRTY_DAYS_MS + 1);
    expect(res).toEqual({ valid: false, expired: true });
  });

  it("rejette un HMAC falsifié (signature invalide)", () => {
    const { token } = generatePrefillToken(LEAD_ID, FIXED_NOW);
    const tampered = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
    const res = verifyPrefillToken(tampered, FIXED_NOW + 1000);
    expect(res).toEqual({ valid: false, expired: false });
  });

  it("rejette un token signé avec un autre secret (rotation)", () => {
    const { token } = generatePrefillToken(LEAD_ID, FIXED_NOW);
    setSecret("autre-secret-apres-rotation");
    const res = verifyPrefillToken(token, FIXED_NOW + 1000);
    expect(res).toEqual({ valid: false, expired: false });
  });

  it("rejette un format malformé", () => {
    for (const bad of ["", "x", "a.b", "a.b.c.d", `${LEAD_ID}.notnum.abc`]) {
      expect(verifyPrefillToken(bad, FIXED_NOW).valid).toBe(false);
    }
  });

  it("rejette si le leadId du token n'est pas un UUID", () => {
    // ts + hex valides en forme mais leadId garbage
    const res = verifyPrefillToken(
      `not-uuid.${FIXED_NOW + THIRTY_DAYS_MS}.${"a".repeat(32)}`,
      FIXED_NOW,
    );
    expect(res).toEqual({ valid: false, expired: false });
  });
});
