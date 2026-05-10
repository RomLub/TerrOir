import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Tests F-018 (audit pre-launch 2026-05-10) — assertion runtime livemode au
// boot serveur Stripe. Le module lib/stripe/server.ts s'évalue à l'import,
// donc on utilise vi.resetModules() pour forcer une nouvelle évaluation
// par test avec process.env modifié.

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  delete process.env.STRIPE_EXPECTED_MODE;
  delete process.env.VERCEL_ENV;
  delete process.env.STRIPE_SECRET_KEY;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("lib/stripe/server — F-018 livemode assertion", () => {
  it("throws si STRIPE_SECRET_KEY absent", async () => {
    await expect(import("@/lib/stripe/server")).rejects.toThrow(
      /Missing STRIPE_SECRET_KEY/,
    );
  });

  it("accepte sk_test_* en dev (pas de VERCEL_ENV)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_abc123";
    const mod = await import("@/lib/stripe/server");
    expect(mod.stripe).toBeDefined();
  });

  it("accepte sk_live_* en dev (pas de VERCEL_ENV)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_abc123";
    const mod = await import("@/lib/stripe/server");
    expect(mod.stripe).toBeDefined();
  });

  it("rejette sk_test_* en VERCEL_ENV=production", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.STRIPE_SECRET_KEY = "sk_test_abc123";
    await expect(import("@/lib/stripe/server")).rejects.toThrow(
      /STRIPE_LIVEMODE_MISMATCH.*sk_live_/,
    );
  });

  it("accepte sk_live_* en VERCEL_ENV=production", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.STRIPE_SECRET_KEY = "sk_live_abc123";
    const mod = await import("@/lib/stripe/server");
    expect(mod.stripe).toBeDefined();
  });

  it("STRIPE_EXPECTED_MODE=test bypass production check (preview branche)", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.STRIPE_EXPECTED_MODE = "test";
    process.env.STRIPE_SECRET_KEY = "sk_test_abc123";
    const mod = await import("@/lib/stripe/server");
    expect(mod.stripe).toBeDefined();
  });

  it("STRIPE_EXPECTED_MODE=test rejette si secret n'est pas sk_test_*", async () => {
    process.env.STRIPE_EXPECTED_MODE = "test";
    process.env.STRIPE_SECRET_KEY = "sk_live_abc123";
    await expect(import("@/lib/stripe/server")).rejects.toThrow(
      /STRIPE_LIVEMODE_MISMATCH.*sk_test_/,
    );
  });

  it("STRIPE_EXPECTED_MODE=live rejette sk_test_* même hors VERCEL_ENV=production", async () => {
    process.env.STRIPE_EXPECTED_MODE = "live";
    process.env.STRIPE_SECRET_KEY = "sk_test_abc123";
    await expect(import("@/lib/stripe/server")).rejects.toThrow(
      /STRIPE_LIVEMODE_MISMATCH.*sk_live_/,
    );
  });
});
