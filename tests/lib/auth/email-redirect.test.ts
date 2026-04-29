import { describe, it, expect, vi } from "vitest";

// lib/env/urls.ts fail-fast au load si NEXT_PUBLIC_APP_URL ou
// NEXT_PUBLIC_ADMIN_URL ne sont pas définis. Pattern hoisted pour set les
// vars AVANT l'évaluation des imports static (cf. tests/lib/auth/
// role-switcher-urls.test.ts). Valeurs distinctes du host prod pour
// vérifier que les constantes dérivent bien des env vars (pas hardcodées).
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://app.test";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "https://pro.test";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.test";
});

import {
  AUTH_CALLBACK_ADMIN,
  AUTH_CALLBACK_DEFAULT,
  PASSWORD_RESET_ADMIN,
  PASSWORD_RESET_DEFAULT,
  getAuthCallbackUrl,
  getPasswordResetUrl,
} from "@/lib/auth/email-redirect";

describe("email-redirect — env-driven preview-aware (T-328)", () => {
  describe("getAuthCallbackUrl(isAdmin)", () => {
    it("isAdmin=true → admin URL /auth/callback", () => {
      expect(getAuthCallbackUrl(true)).toBe("https://admin.test/auth/callback");
    });

    it("isAdmin=false → app URL /auth/callback", () => {
      expect(getAuthCallbackUrl(false)).toBe("https://app.test/auth/callback");
    });
  });

  describe("getPasswordResetUrl(isAdmin)", () => {
    it("isAdmin=true → admin URL /reinitialiser-mot-de-passe", () => {
      expect(getPasswordResetUrl(true)).toBe(
        "https://admin.test/reinitialiser-mot-de-passe",
      );
    });

    it("isAdmin=false → app URL /reinitialiser-mot-de-passe", () => {
      expect(getPasswordResetUrl(false)).toBe(
        "https://app.test/reinitialiser-mot-de-passe",
      );
    });
  });

  describe("invariant Chantier 4 — admin isolation cookies", () => {
    it("AUTH_CALLBACK_ADMIN ≠ AUTH_CALLBACK_DEFAULT (admin host distinct)", () => {
      expect(AUTH_CALLBACK_ADMIN).not.toBe(AUTH_CALLBACK_DEFAULT);
      expect(AUTH_CALLBACK_ADMIN).toContain("admin.test");
      expect(AUTH_CALLBACK_DEFAULT).toContain("app.test");
    });

    it("PASSWORD_RESET_ADMIN ≠ PASSWORD_RESET_DEFAULT (admin host distinct)", () => {
      expect(PASSWORD_RESET_ADMIN).not.toBe(PASSWORD_RESET_DEFAULT);
      expect(PASSWORD_RESET_ADMIN).toContain("admin.test");
      expect(PASSWORD_RESET_DEFAULT).toContain("app.test");
    });
  });

  describe("dérivation env vars (preview-aware, pas hardcoded)", () => {
    it("constantes dérivent bien des env vars NEXT_PUBLIC_* (re-import avec autres vars)", async () => {
      const original = {
        app: process.env.NEXT_PUBLIC_APP_URL,
        admin: process.env.NEXT_PUBLIC_ADMIN_URL,
      };
      try {
        process.env.NEXT_PUBLIC_APP_URL = "https://preview-www.vercel.app";
        process.env.NEXT_PUBLIC_ADMIN_URL = "https://preview-admin.vercel.app";
        vi.resetModules();
        const mod = await import("@/lib/auth/email-redirect");
        expect(mod.AUTH_CALLBACK_DEFAULT).toBe(
          "https://preview-www.vercel.app/auth/callback",
        );
        expect(mod.AUTH_CALLBACK_ADMIN).toBe(
          "https://preview-admin.vercel.app/auth/callback",
        );
        expect(mod.PASSWORD_RESET_DEFAULT).toBe(
          "https://preview-www.vercel.app/reinitialiser-mot-de-passe",
        );
        expect(mod.PASSWORD_RESET_ADMIN).toBe(
          "https://preview-admin.vercel.app/reinitialiser-mot-de-passe",
        );
      } finally {
        process.env.NEXT_PUBLIC_APP_URL = original.app;
        process.env.NEXT_PUBLIC_ADMIN_URL = original.admin;
        vi.resetModules();
      }
    });
  });

  describe("paths attendus (defense vs typo)", () => {
    it("auth callbacks finissent par /auth/callback (pas de query string)", () => {
      expect(AUTH_CALLBACK_ADMIN.endsWith("/auth/callback")).toBe(true);
      expect(AUTH_CALLBACK_DEFAULT.endsWith("/auth/callback")).toBe(true);
      expect(AUTH_CALLBACK_ADMIN).not.toContain("?");
      expect(AUTH_CALLBACK_DEFAULT).not.toContain("?");
    });

    it("password reset finit par /reinitialiser-mot-de-passe (pas de query string — Supabase ajoute ?token_hash=...)", () => {
      expect(PASSWORD_RESET_ADMIN.endsWith("/reinitialiser-mot-de-passe")).toBe(
        true,
      );
      expect(
        PASSWORD_RESET_DEFAULT.endsWith("/reinitialiser-mot-de-passe"),
      ).toBe(true);
      expect(PASSWORD_RESET_ADMIN).not.toContain("?");
      expect(PASSWORD_RESET_DEFAULT).not.toContain("?");
    });
  });
});
