import { describe, it, expect, vi } from "vitest";

// EMAIL_CHANGE_OTP_SECRET requise au module-load par lib/email-change/hmac.ts.
// Hoist le stub avant les imports static (pattern aligné stock-alert-confirm
// .test.tsx + change-password.test.ts).
vi.hoisted(() => {
  process.env.EMAIL_CHANGE_OTP_SECRET =
    process.env.EMAIL_CHANGE_OTP_SECRET ??
    "test-only-secret-do-not-use-in-prod-32bytes-min";
});

import { hashOtp, verifyHash } from "@/lib/email-change/hmac";

describe("hashOtp", () => {
  it("retourne un hex de 64 caractères (HMAC-SHA256)", async () => {
    const hash = await hashOtp("123456");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("est déterministe (même code → même hash)", async () => {
    const a = await hashOtp("123456");
    const b = await hashOtp("123456");
    expect(a).toBe(b);
  });

  it("change pour des codes différents", async () => {
    const a = await hashOtp("123456");
    const b = await hashOtp("123457");
    expect(a).not.toBe(b);
  });

  it("avalanche : codes proches → hashes très différents", async () => {
    const a = await hashOtp("000000");
    const b = await hashOtp("000001");
    // HMAC bonne diffusion : au moins 16/32 bytes (50%) doivent différer.
    let diffBytes = 0;
    for (let i = 0; i < a.length; i += 2) {
      if (a.slice(i, i + 2) !== b.slice(i, i + 2)) diffBytes++;
    }
    expect(diffBytes).toBeGreaterThanOrEqual(16);
  });
});

describe("verifyHash", () => {
  it("retourne true pour un hash valide", async () => {
    const hash = await hashOtp("123456");
    expect(await verifyHash("123456", hash)).toBe(true);
  });

  it("retourne false pour un code différent", async () => {
    const hash = await hashOtp("123456");
    expect(await verifyHash("123457", hash)).toBe(false);
  });

  it("retourne false pour un hash de taille différente (chaîne vide)", async () => {
    expect(await verifyHash("123456", "")).toBe(false);
  });

  it("retourne false pour un hash de taille différente (3 chars)", async () => {
    expect(await verifyHash("123456", "abc")).toBe(false);
  });

  it("retourne false pour un hash valide corrompu (1 char modifié)", async () => {
    const hash = await hashOtp("123456");
    const corrupted = hash.slice(0, 63) + (hash[63] === "0" ? "1" : "0");
    expect(await verifyHash("123456", corrupted)).toBe(false);
  });

  it("retourne false sur hash totalement aléatoire de bonne taille", async () => {
    const fakeHash = "f".repeat(64);
    expect(await verifyHash("123456", fakeHash)).toBe(false);
  });
});

describe("module-load fail-fast", () => {
  it("throw si EMAIL_CHANGE_OTP_SECRET absent au module-load", async () => {
    vi.resetModules();
    const original = process.env.EMAIL_CHANGE_OTP_SECRET;
    delete process.env.EMAIL_CHANGE_OTP_SECRET;
    try {
      await expect(import("@/lib/email-change/hmac")).rejects.toThrow(
        /EMAIL_CHANGE_OTP_SECRET/,
      );
    } finally {
      process.env.EMAIL_CHANGE_OTP_SECRET = original;
      vi.resetModules();
    }
  });
});
