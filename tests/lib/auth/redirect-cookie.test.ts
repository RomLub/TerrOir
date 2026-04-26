import { describe, it, expect, vi } from "vitest";

// `server-only` est un module virtuel Next.js qui throw côté client. Il n'est
// pas résolu par vitest, on le stub avant l'import du helper.
vi.mock("server-only", () => ({}));

// Mocks next/headers AVANT l'import du module testé : cookies/headers ne
// peuvent être appelés qu'en contexte server (App Router). On simule juste
// l'API minimale dont le helper a besoin.
vi.mock("next/headers", () => ({
  cookies: vi.fn(),
  headers: vi.fn(),
}));

import { cookies, headers } from "next/headers";
import {
  __test__,
  setRedirectAfterAuth,
  readRedirectAfterAuth,
  clearRedirectAfterAuth,
} from "@/lib/auth/redirect-cookie";

const { cookieOptionsForHost, COOKIE_NAME } = __test__;

describe("cookieOptionsForHost", () => {
  it("retourne domain partagé en prod (apex terroir-local.fr)", () => {
    const opts = cookieOptionsForHost("terroir-local.fr");
    expect(opts.domain).toBe(".terroir-local.fr");
    expect(opts.secure).toBe(true);
  });

  it("retourne domain partagé en prod (sous-domaine www)", () => {
    const opts = cookieOptionsForHost("www.terroir-local.fr");
    expect(opts.domain).toBe(".terroir-local.fr");
    expect(opts.secure).toBe(true);
  });

  it("retourne domain partagé en prod (sous-domaine admin)", () => {
    const opts = cookieOptionsForHost("admin.terroir-local.fr");
    expect(opts.domain).toBe(".terroir-local.fr");
    expect(opts.secure).toBe(true);
  });

  it("strip le port avant la détection", () => {
    const opts = cookieOptionsForHost("www.terroir-local.fr:443");
    expect(opts.domain).toBe(".terroir-local.fr");
  });

  it("ne pose PAS de domain en dev (localhost) et désactive secure", () => {
    const opts = cookieOptionsForHost("localhost:3000");
    expect(opts.domain).toBeUndefined();
    expect(opts.secure).toBe(false);
  });

  it("ne pose PAS de domain sur un host inconnu (staging perso)", () => {
    const opts = cookieOptionsForHost("preview-foo.vercel.app");
    expect(opts.domain).toBeUndefined();
    expect(opts.secure).toBe(false);
  });

  it("force HttpOnly + SameSite=Lax + path=/ + maxAge raisonnable", () => {
    const opts = cookieOptionsForHost("www.terroir-local.fr");
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.path).toBe("/");
    expect(opts.maxAge).toBeGreaterThan(0);
    expect(opts.maxAge).toBeLessThanOrEqual(60 * 60);
  });

  it("traite host null/undefined comme dev (pas de domain)", () => {
    expect(cookieOptionsForHost(null).domain).toBeUndefined();
    expect(cookieOptionsForHost(undefined).domain).toBeUndefined();
  });
});

describe("setRedirectAfterAuth", () => {
  it("pose le cookie quand le path est valide", () => {
    const setSpy = vi.fn();
    vi.mocked(cookies).mockReturnValue({ set: setSpy } as never);
    vi.mocked(headers).mockReturnValue({
      get: () => "www.terroir-local.fr",
    } as never);

    setRedirectAfterAuth("/panier");

    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith(
      COOKIE_NAME,
      "/panier",
      expect.objectContaining({
        domain: ".terroir-local.fr",
        path: "/",
        httpOnly: true,
        sameSite: "lax",
      }),
    );
  });

  it("ignore silencieusement les paths invalides (open-redirect guard)", () => {
    const setSpy = vi.fn();
    vi.mocked(cookies).mockReturnValue({ set: setSpy } as never);
    vi.mocked(headers).mockReturnValue({
      get: () => "www.terroir-local.fr",
    } as never);

    setRedirectAfterAuth("https://evil.example.com/phish");
    setRedirectAfterAuth("//evil.example.com");
    setRedirectAfterAuth("");
    setRedirectAfterAuth(null);
    setRedirectAfterAuth(undefined);

    expect(setSpy).not.toHaveBeenCalled();
  });
});

describe("readRedirectAfterAuth", () => {
  function makeRequest(cookieValue: string | undefined) {
    return {
      cookies: {
        get: (name: string) =>
          name === COOKIE_NAME && cookieValue !== undefined
            ? { value: cookieValue }
            : undefined,
      },
    } as unknown as Parameters<typeof readRedirectAfterAuth>[0];
  }

  it("retourne le path du cookie quand il est valide", () => {
    expect(readRedirectAfterAuth(makeRequest("/panier"))).toBe("/panier");
  });

  it("retourne null quand le cookie est absent", () => {
    expect(readRedirectAfterAuth(makeRequest(undefined))).toBeNull();
  });

  it("retourne null quand le cookie contient un open-redirect (//host)", () => {
    expect(readRedirectAfterAuth(makeRequest("//evil.example.com"))).toBeNull();
  });

  it("retourne null quand le cookie contient une URL absolue", () => {
    expect(
      readRedirectAfterAuth(makeRequest("https://evil.example.com")),
    ).toBeNull();
  });

  it("retourne null quand le cookie est vide", () => {
    expect(readRedirectAfterAuth(makeRequest(""))).toBeNull();
  });
});

describe("clearRedirectAfterAuth", () => {
  it("pose un cookie expiré (maxAge=0) avec les mêmes domain/path que le set", () => {
    const setSpy = vi.fn();
    const fakeResponse = {
      cookies: { set: setSpy },
    } as unknown as Parameters<typeof clearRedirectAfterAuth>[0];

    clearRedirectAfterAuth(fakeResponse, "www.terroir-local.fr");

    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith(
      COOKIE_NAME,
      "",
      expect.objectContaining({
        domain: ".terroir-local.fr",
        path: "/",
        maxAge: 0,
        httpOnly: true,
        sameSite: "lax",
      }),
    );
  });
});
