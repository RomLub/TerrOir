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

const { cookieOptionsForHost, cookieNameForHost, COOKIE_NAME_DEV, COOKIE_NAME_PROD } = __test__;

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
  it("pose le cookie quand le path est valide (prod → __Secure- prefix)", async () => {
    const setSpy = vi.fn();
    vi.mocked(cookies).mockResolvedValue({ set: setSpy } as never);
    vi.mocked(headers).mockResolvedValue({
      get: () => "www.terroir-local.fr",
    } as never);

    await setRedirectAfterAuth("/panier");

    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith(
      COOKIE_NAME_PROD,
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

  it("ignore silencieusement les paths invalides (open-redirect guard)", async () => {
    const setSpy = vi.fn();
    vi.mocked(cookies).mockResolvedValue({ set: setSpy } as never);
    vi.mocked(headers).mockResolvedValue({
      get: () => "www.terroir-local.fr",
    } as never);

    await setRedirectAfterAuth("https://evil.example.com/phish");
    await setRedirectAfterAuth("//evil.example.com");
    await setRedirectAfterAuth("");
    await setRedirectAfterAuth(null);
    await setRedirectAfterAuth(undefined);

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

  it("retourne le path du cookie quand il est valide (prod __Secure- prefix)", () => {
    expect(
      readRedirectAfterAuth(makeRequest({ cookieValue: "/panier" })),
    ).toBe("/panier");
  });

  it("retourne le path du cookie en dev (nom sans prefix)", () => {
    expect(
      readRedirectAfterAuth(
        makeRequest({
          host: "localhost:3000",
          cookieName: COOKIE_NAME_DEV,
          cookieValue: "/panier",
        }),
      ),
    ).toBe("/panier");
  });

  it("debt-P1-3 : ne lit PAS le cookie sans prefix en prod (double-lecture legacy retirée)", () => {
    // Avant 2026-05-12 : fallback transitoire vers le nom sans prefix.
    // Désormais : un cookie sans prefix sur un host prod est ignoré (TTL
    // 1h écoulé depuis migration M-2 le 2026-05-05).
    expect(
      readRedirectAfterAuth(
        makeRequest({
          host: "www.terroir-local.fr",
          cookieName: COOKIE_NAME_DEV,
          cookieValue: "/panier",
        }),
      ),
    ).toBeNull();
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
  it("pose 1 seul cookie expiré en prod (debt-P1-3 : double-clear legacy retiré)", () => {
    const setSpy = vi.fn();
    const fakeResponse = {
      cookies: { set: setSpy },
    } as unknown as Parameters<typeof clearRedirectAfterAuth>[0];

    clearRedirectAfterAuth(fakeResponse, "www.terroir-local.fr");

    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith(
      COOKIE_NAME_PROD,
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

  it("pose 1 seul cookie en dev (sans prefix)", () => {
    const setSpy = vi.fn();
    const fakeResponse = {
      cookies: { set: setSpy },
    } as unknown as Parameters<typeof clearRedirectAfterAuth>[0];

    clearRedirectAfterAuth(fakeResponse, "localhost:3000");

    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith(
      COOKIE_NAME_DEV,
      "",
      expect.objectContaining({ maxAge: 0 }),
    );
  });
});
