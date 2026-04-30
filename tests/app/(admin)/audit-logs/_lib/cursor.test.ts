import { describe, it, expect } from "vitest";

import {
  encodeCursor,
  decodeCursor,
} from "@/app/(admin)/audit-logs/_lib/cursor";

describe("cursor encode/decode", () => {
  it("roundtrip : decode(encode(x)) === x", () => {
    const c = { createdAt: "2026-04-30T12:34:56.000Z", id: "abc-123" };
    const encoded = encodeCursor(c);
    expect(typeof encoded).toBe("string");
    expect(encoded.length).toBeGreaterThan(0);
    expect(decodeCursor(encoded)).toEqual(c);
  });

  it("encode produit un base64url-safe (pas de + / =)", () => {
    const longId = "a".repeat(64);
    const c = { createdAt: "2026-04-30T12:34:56.000Z", id: longId };
    const encoded = encodeCursor(c);
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it("decodeCursor(null) → null", () => {
    expect(decodeCursor(null)).toBeNull();
  });

  it("decodeCursor('') → null (chaîne vide rejetée)", () => {
    expect(decodeCursor("")).toBeNull();
  });

  it("decodeCursor d'un base64 invalide → null", () => {
    expect(decodeCursor("!!!not-base64!!!")).toBeNull();
  });

  it("decodeCursor d'un JSON valide mais structure incorrecte → null", () => {
    const garbage = Buffer.from(
      JSON.stringify({ foo: "bar" }),
      "utf8",
    ).toString("base64url");
    expect(decodeCursor(garbage)).toBeNull();
  });

  it("decodeCursor d'un JSON avec champs typés incorrects → null", () => {
    const wrongTypes = Buffer.from(
      JSON.stringify({ createdAt: 123, id: 456 }),
      "utf8",
    ).toString("base64url");
    expect(decodeCursor(wrongTypes)).toBeNull();
  });
});
