import { describe, it, expect, vi } from "vitest";

// `lib/auth/post-login-redirect.ts` importe 'server-only' (virtuel Next.js,
// non résolvable hors build webpack) → stub no-op pour vitest.
vi.mock("server-only", () => ({}));

import {
  isValidRedirectPath,
  resolvePostLoginPath,
  type RoleSnapshot,
} from "@/lib/auth/post-login-redirect";

const PRODUCER_HOST = "pro.terroir-local.fr";
const WWW_HOST = "www.terroir-local.fr";

const consumer: RoleSnapshot = {
  isAdmin: false,
  isProducer: false,
  producerStatut: null,
};
const admin: RoleSnapshot = {
  isAdmin: true,
  isProducer: false,
  producerStatut: null,
};
const producerPublic: RoleSnapshot = {
  isAdmin: false,
  isProducer: true,
  producerStatut: "public",
};
const producerDraft: RoleSnapshot = {
  isAdmin: false,
  isProducer: true,
  producerStatut: "draft",
};

describe("isValidRedirectPath", () => {
  it("accepte un path local valide", () => {
    expect(isValidRedirectPath("/panier")).toBe(true);
  });

  it("accepte le root path", () => {
    expect(isValidRedirectPath("/")).toBe(true);
  });

  it("rejette undefined", () => {
    expect(isValidRedirectPath(undefined)).toBe(false);
  });

  it("rejette null", () => {
    expect(isValidRedirectPath(null)).toBe(false);
  });

  it("rejette la chaîne vide", () => {
    expect(isValidRedirectPath("")).toBe(false);
  });

  it("rejette une URL protocol-relative (//evil.com)", () => {
    expect(isValidRedirectPath("//evil.com")).toBe(false);
  });

  it("rejette /\\evil.com (browser normalise en //)", () => {
    expect(isValidRedirectPath("/\\evil.com")).toBe(false);
  });

  it("rejette une URL absolue (https://evil.com)", () => {
    expect(isValidRedirectPath("https://evil.com")).toBe(false);
  });

  it("rejette un schéma javascript: (XSS)", () => {
    expect(isValidRedirectPath("javascript:alert(1)")).toBe(false);
  });

  it("rejette un path sans / initial", () => {
    expect(isValidRedirectPath("panier")).toBe(false);
  });
});

describe("resolvePostLoginPath", () => {
  it("respecte un redirectTo local valide pour un consumer", () => {
    expect(resolvePostLoginPath(consumer, WWW_HOST, "/panier")).toBe("/panier");
  });

  it("fallback vers /compte pour un consumer sans redirectTo", () => {
    expect(resolvePostLoginPath(consumer, WWW_HOST, undefined)).toBe("/compte");
  });

  it("respecte un redirectTo local valide pour un producer sur pro.*", () => {
    expect(
      resolvePostLoginPath(producerPublic, PRODUCER_HOST, "/dashboard"),
    ).toBe("/dashboard");
  });

  it("fallback /tableau-de-bord pour admin sans redirectTo", () => {
    expect(resolvePostLoginPath(admin, WWW_HOST, undefined)).toBe(
      "/tableau-de-bord",
    );
  });

  it("ignore un redirectTo open-redirect et fallback canonique pour admin", () => {
    expect(resolvePostLoginPath(admin, WWW_HOST, "//evil.com")).toBe(
      "/tableau-de-bord",
    );
  });

  it("ignore un redirectTo vide et fallback /compte pour consumer", () => {
    expect(resolvePostLoginPath(consumer, WWW_HOST, "")).toBe("/compte");
  });

  it("fallback /onboarding pour producer draft sur pro.* sans redirectTo", () => {
    expect(
      resolvePostLoginPath(producerDraft, PRODUCER_HOST, undefined),
    ).toBe("/onboarding");
  });

  it("fallback /dashboard pour producer public sur pro.* sans redirectTo", () => {
    expect(
      resolvePostLoginPath(producerPublic, PRODUCER_HOST, undefined),
    ).toBe("/dashboard");
  });
});
