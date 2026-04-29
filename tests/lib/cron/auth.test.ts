import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { assertCronAuth } from "@/lib/cron/auth";

// `assertCronAuth` lit process.env.CRON_SECRET à chaque appel, donc muter
// la variable au runtime suffit (pas besoin de vi.resetModules).
const ORIGINAL_SECRET = process.env.CRON_SECRET;
const VALID_SECRET = "test-cron-secret-unit-T423";

function setSecret(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = value;
  }
}

beforeEach(() => {
  setSecret(VALID_SECRET);
});

afterEach(() => {
  setSecret(ORIGINAL_SECRET);
});

describe("assertCronAuth — T-423 constant-time", () => {
  it("retourne null pour un header `Bearer <secret>` valide", () => {
    const req = new Request("http://x/api/cron/x", {
      headers: { authorization: `Bearer ${VALID_SECRET}` },
    });
    expect(assertCronAuth(req)).toBeNull();
  });

  it("retourne 401 si le header authorization est absent", async () => {
    const req = new Request("http://x/api/cron/x");
    const res = assertCronAuth(req);
    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "Unauthorized" });
  });

  it("retourne 401 pour un secret incorrect de même longueur (full-buffer compare)", () => {
    // Même longueur que VALID_SECRET → safeCompare passe par timingSafeEqual,
    // pas par le short-circuit length-check.
    const wrong = "x".repeat(VALID_SECRET.length);
    expect(wrong).toHaveLength(VALID_SECRET.length);
    const req = new Request("http://x/api/cron/x", {
      headers: { authorization: `Bearer ${wrong}` },
    });
    expect(assertCronAuth(req)?.status).toBe(401);
  });

  it("retourne 401 sans throw RangeError si la longueur diffère", () => {
    // Garde anti-RangeError : timingSafeEqual throw si bufA.length !== bufB.length,
    // safeCompare doit court-circuiter avant.
    const req = new Request("http://x/api/cron/x", {
      headers: { authorization: "Bearer x" },
    });
    expect(() => assertCronAuth(req)).not.toThrow();
    expect(assertCronAuth(req)?.status).toBe(401);
  });

  it("retourne 401 pour un schema d'auth incorrect (Basic au lieu de Bearer)", () => {
    const req = new Request("http://x/api/cron/x", {
      headers: { authorization: `Basic ${VALID_SECRET}` },
    });
    expect(assertCronAuth(req)?.status).toBe(401);
  });

  it("retourne 500 si CRON_SECRET n'est pas configuré côté env", async () => {
    setSecret(undefined);
    const req = new Request("http://x/api/cron/x", {
      headers: { authorization: "Bearer whatever" },
    });
    const res = assertCronAuth(req);
    expect(res?.status).toBe(500);
    expect(await res?.json()).toEqual({ error: "CRON_SECRET not configured" });
  });
});
