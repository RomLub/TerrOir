// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock next/headers pour le test du wrapper server.
const cookiesMock = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => cookiesMock(),
}));

import { hasConsentClient, hasConsentServer } from "@/lib/rgpd/has-consent";
import {
  COOKIE_CONSENT_NAME,
  acceptAllConsent,
  rejectAllConsent,
  serializeConsent,
} from "@/lib/rgpd/cookie-consent";

const FIXED_NOW = new Date("2026-05-10T12:00:00.000Z");

beforeEach(() => {
  cookiesMock.mockReset();
  // Reset cookie côté jsdom.
  document.cookie = `${COOKIE_CONSENT_NAME}=; Max-Age=0; Path=/`;
});

describe("hasConsentClient", () => {
  it("essentials toujours true même sans cookie", () => {
    expect(hasConsentClient("essentials")).toBe(true);
  });

  it("analytics/marketing false par défaut (cookie absent)", () => {
    expect(hasConsentClient("analytics")).toBe(false);
    expect(hasConsentClient("marketing")).toBe(false);
  });

  it("retourne true pour analytics si cookie accept-all présent", () => {
    const c = acceptAllConsent(FIXED_NOW);
    document.cookie = `${COOKIE_CONSENT_NAME}=${serializeConsent(c)}; Path=/`;
    expect(hasConsentClient("analytics")).toBe(true);
    expect(hasConsentClient("marketing")).toBe(true);
  });

  it("retourne false pour analytics si cookie reject-all présent", () => {
    const c = rejectAllConsent(FIXED_NOW);
    document.cookie = `${COOKIE_CONSENT_NAME}=${serializeConsent(c)}; Path=/`;
    expect(hasConsentClient("analytics")).toBe(false);
    expect(hasConsentClient("marketing")).toBe(false);
  });

  it("cookie corrompu → fallback false (deny-by-default)", () => {
    document.cookie = `${COOKIE_CONSENT_NAME}=not-valid-json; Path=/`;
    expect(hasConsentClient("analytics")).toBe(false);
  });
});

describe("hasConsentServer", () => {
  it("essentials toujours true (court-circuit avant lecture cookie)", async () => {
    cookiesMock.mockImplementation(() => {
      throw new Error("should not be called for essentials");
    });
    await expect(hasConsentServer("essentials")).resolves.toBe(true);
  });

  it("analytics false par défaut quand le cookie est absent", async () => {
    cookiesMock.mockResolvedValue({
      get: () => undefined,
    });
    await expect(hasConsentServer("analytics")).resolves.toBe(false);
  });

  it("analytics true si cookie accept-all présent", async () => {
    const c = acceptAllConsent(FIXED_NOW);
    cookiesMock.mockResolvedValue({
      get: (name: string) => {
        if (name === COOKIE_CONSENT_NAME) {
          return { value: serializeConsent(c) };
        }
        return undefined;
      },
    });
    await expect(hasConsentServer("analytics")).resolves.toBe(true);
    await expect(hasConsentServer("marketing")).resolves.toBe(true);
  });

  it("retourne false si next/headers cookies() throw (fail-safe)", async () => {
    cookiesMock.mockImplementation(() => {
      throw new Error("cookies() called outside of server context");
    });
    await expect(hasConsentServer("analytics")).resolves.toBe(false);
  });
});
