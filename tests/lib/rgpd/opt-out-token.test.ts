import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// `lib/rgpd/opt-out-token.ts` importe 'server-only' (virtuel Next.js, non
// résolvable hors build webpack) → stub no-op pour vitest.
vi.mock("server-only", () => ({}));

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

describe("generateOptOutToken", () => {
  it("retourne 32 caractères hex", () => {
    const token = generateOptOutToken("user@example.com");
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(token).toHaveLength(32);
  });

  it("email normalisé (casse + espaces) produit le même token", () => {
    const a = generateOptOutToken("user@example.com");
    const b = generateOptOutToken("USER@EXAMPLE.COM");
    const c = generateOptOutToken("  User@Example.com  ");
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it("déterministe : deux appels avec même input → même token", () => {
    const a = generateOptOutToken("user@example.com");
    const b = generateOptOutToken("user@example.com");
    expect(a).toBe(b);
  });

  it("secrets différents → tokens différents pour le même email", () => {
    setSecret("secret-A");
    const a = generateOptOutToken("user@example.com");
    setSecret("secret-B");
    const b = generateOptOutToken("user@example.com");
    expect(a).not.toBe(b);
  });

  it("throw si OPT_OUT_TOKEN_SECRET est absent", () => {
    setSecret(undefined);
    expect(() => generateOptOutToken("user@example.com")).toThrow(
      /OPT_OUT_TOKEN_SECRET/,
    );
  });
});

describe("verifyOptOutToken", () => {
  it("accepte un token fraîchement généré", () => {
    const token = generateOptOutToken("user@example.com");
    expect(verifyOptOutToken("user@example.com", token)).toBe(true);
  });

  it("accepte après normalisation casse/espaces côté vérif", () => {
    const token = generateOptOutToken("user@example.com");
    expect(verifyOptOutToken("USER@EXAMPLE.COM", token)).toBe(true);
    expect(verifyOptOutToken("  user@example.com  ", token)).toBe(true);
  });

  it("rejette un token valide pour un autre email (pas de collision)", () => {
    const token = generateOptOutToken("alice@example.com");
    expect(verifyOptOutToken("bob@example.com", token)).toBe(false);
  });

  it("rejette un token de longueur ≠ 32", () => {
    const short = "a".repeat(31);
    const long = "a".repeat(33);
    expect(verifyOptOutToken("user@example.com", short)).toBe(false);
    expect(verifyOptOutToken("user@example.com", long)).toBe(false);
  });

  it("rejette un token contenant des caractères non-hex", () => {
    const bad = "Z".repeat(32); // 32 chars mais Z hors [0-9a-f]
    expect(verifyOptOutToken("user@example.com", bad)).toBe(false);
  });

  it("rejette un token vide", () => {
    expect(verifyOptOutToken("user@example.com", "")).toBe(false);
  });

  it("rejette un token non-string", () => {
    // cast volontaire : on simule un call-site qui recevrait null/number d'un
    // query param mal parsé — le helper doit être robuste au typage runtime.
    expect(verifyOptOutToken("user@example.com", null as unknown as string)).toBe(
      false,
    );
    expect(
      verifyOptOutToken("user@example.com", 123 as unknown as string),
    ).toBe(false);
  });

  it("rejette un token hex valide mais erroné (bit flip)", () => {
    const token = generateOptOutToken("user@example.com");
    // flip le 1er char en restant dans [0-9a-f]
    const flipped =
      (token[0] === "0" ? "1" : "0") + token.slice(1);
    expect(verifyOptOutToken("user@example.com", flipped)).toBe(false);
  });

  it("throw si OPT_OUT_TOKEN_SECRET absent (propagation via generate)", () => {
    const token = generateOptOutToken("user@example.com");
    setSecret(undefined);
    expect(() => verifyOptOutToken("user@example.com", token)).toThrow(
      /OPT_OUT_TOKEN_SECRET/,
    );
  });
});
