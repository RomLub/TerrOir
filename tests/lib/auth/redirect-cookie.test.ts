import { describe, it, expect, vi } from "vitest";

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

const { cookieOptionsForHost, cookieNameForHost, COOKIE_NAME_LEGACY, COOKIE_NAME_NEW } = __test__;

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
  it("pose le cookie quand le path est valide (prod → __Secure- prefix)", () => {
    const setSpy = vi.fn();
    vi.mocked(cookies).mockReturnValue({ set: setSpy } as never);
    vi.mocked(headers).mockReturnValue({
      get: () => "www.terroir-local.fr",
    } as never);

    setRedirectAfterAuth("/panier");

    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith(
      COOKIE_NAME_NEW,
      "/panier",
      expect.objectContaining({
        domain: ".terroir-local.fr",
        path: "/",
        httpOnly: true,
        secure: true,
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
  // Helper : simule une request avec un cookie posé sous un nom donné +
  // header host. La double-lecture (M-2) essaie le nouveau nom puis legacy.
  function makeRequest(opts: {
    cookieName?: string;
    cookieValue?: string;
    host?: string;
  }) {
    const host = opts.host ?? "www.terroir-local.fr";
    const cookieName = opts.cookieName ?? cookieNameForHost(host);
    return {
      headers: {
        get: (name: string) => (name === "host" ? host : null),
      },
      cookies: {
        get: (name: string) =>
          name === cookieName && opts.cookieValue !== undefined
            ? { value: opts.cookieValue }
            : undefined,
      },
    } as unknown as Parameters<typeof readRedirectAfterAuth>[0];
  }

  it("retourne le path du cookie quand il est valide (nouveau nom prod)", () => {
    expect(
      readRedirectAfterAuth(makeRequest({ cookieValue: "/panier" })),
    ).toBe("/panier");
  });

  it("fallback legacy : lit l'ancien nom si le nouveau est absent (transition M-2)", () => {
    expect(
      readRedirectAfterAuth(
        makeRequest({ cookieName: COOKIE_NAME_LEGACY, cookieValue: "/panier" }),
      ),
    ).toBe("/panier");
  });

  it("retourne null quand le cookie est absent", () => {
    expect(readRedirectAfterAuth(makeRequest({}))).toBeNull();
  });

  it("retourne null quand le cookie contient un open-redirect (//host)", () => {
    expect(
      readRedirectAfterAuth(makeRequest({ cookieValue: "//evil.example.com" })),
    ).toBeNull();
  });

  it("retourne null quand le cookie contient une URL absolue", () => {
    expect(
      readRedirectAfterAuth(makeRequest({ cookieValue: "https://evil.example.com" })),
    ).toBeNull();
  });

  it("retourne null quand le cookie est vide", () => {
    expect(readRedirectAfterAuth(makeRequest({ cookieValue: "" }))).toBeNull();
  });
});

describe("clearRedirectAfterAuth", () => {
  it("pose 2 cookies expirés (nouveau + legacy) avec mêmes domain/path en prod (M-2 transition)", () => {
    const setSpy = vi.fn();
    const fakeResponse = {
      cookies: { set: setSpy },
    } as unknown as Parameters<typeof clearRedirectAfterAuth>[0];

    clearRedirectAfterAuth(fakeResponse, "www.terroir-local.fr");

    // Prod : new + legacy = 2 calls (transition M-2 jusqu'à 2026-05-12).
    expect(setSpy).toHaveBeenCalledTimes(2);
    expect(setSpy).toHaveBeenCalledWith(
      COOKIE_NAME_NEW,
      "",
      expect.objectContaining({
        domain: ".terroir-local.fr",
        path: "/",
        maxAge: 0,
        httpOnly: true,
        sameSite: "lax",
      }),
    );
    expect(setSpy).toHaveBeenCalledWith(
      COOKIE_NAME_LEGACY,
      "",
      expect.objectContaining({ maxAge: 0 }),
    );
  });

  it("pose 1 seul cookie en dev (legacy = nouveau, pas de double-clear)", () => {
    const setSpy = vi.fn();
    const fakeResponse = {
      cookies: { set: setSpy },
    } as unknown as Parameters<typeof clearRedirectAfterAuth>[0];

    clearRedirectAfterAuth(fakeResponse, "localhost:3000");

    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith(
      COOKIE_NAME_LEGACY,
      "",
      expect.objectContaining({ maxAge: 0 }),
    );
  });
});
