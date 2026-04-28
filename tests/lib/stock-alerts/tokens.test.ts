// Tests vitest pour lib/stock-alerts/tokens.ts.

import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { generateAlertToken } from "@/lib/stock-alerts/tokens";

describe("generateAlertToken", () => {
  it("génère un token de 32 caractères", () => {
    const token = generateAlertToken();
    expect(token).toHaveLength(32);
  });

  it("génère un token URL-safe (base64url : A-Z, a-z, 0-9, -, _)", () => {
    const token = generateAlertToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it("génère des tokens distincts entre appels successifs (entropie)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      seen.add(generateAlertToken());
    }
    // Probabilité collision sur 100 tokens 192 bits ≈ 0 → tous uniques.
    expect(seen.size).toBe(100);
  });
});
