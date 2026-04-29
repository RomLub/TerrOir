import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Couverture du fail-fast au module-load (lib/env/support-email.ts) : on
// teste les 3 chemins via dynamic import + resetModules pour ré-évaluer le
// module à chaque cas.

const ORIGINAL = process.env.SUPPORT_EMAIL;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.SUPPORT_EMAIL;
  } else {
    process.env.SUPPORT_EMAIL = ORIGINAL;
  }
});

describe("lib/env/support-email — fail-fast au module-load", () => {
  it("throw si SUPPORT_EMAIL absent", async () => {
    delete process.env.SUPPORT_EMAIL;
    await expect(import("@/lib/env/support-email")).rejects.toThrow(
      /Missing SUPPORT_EMAIL/,
    );
  });

  it("throw si SUPPORT_EMAIL ne contient pas d'@ (format invalide)", async () => {
    process.env.SUPPORT_EMAIL = "not-an-email";
    await expect(import("@/lib/env/support-email")).rejects.toThrow(
      /Invalid SUPPORT_EMAIL/,
    );
  });

  it("export la valeur si format valide", async () => {
    process.env.SUPPORT_EMAIL = "admin@terroir-local.fr";
    const mod = await import("@/lib/env/support-email");
    expect(mod.SUPPORT_EMAIL).toBe("admin@terroir-local.fr");
  });
});
