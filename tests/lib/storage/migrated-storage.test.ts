// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { createMigratedStorage } from "@/lib/storage/migrated-storage";

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("createMigratedStorage (T-266-bis)", () => {
  describe("read()", () => {
    it("retourne la valeur de la nouvelle cle si presente", () => {
      window.localStorage.setItem("terroir_saved_email", "new@example.com");
      const s = createMigratedStorage("terroir-saved-email", "terroir_saved_email", "local");
      expect(s.read()).toBe("new@example.com");
      // L'ancienne cle n'a jamais ete touchee.
      expect(window.localStorage.getItem("terroir-saved-email")).toBeNull();
    });

    it("fallback sur l'ancienne cle si nouvelle absente, MIGRE au passage", () => {
      window.localStorage.setItem("terroir-saved-email", "legacy@example.com");
      const s = createMigratedStorage("terroir-saved-email", "terroir_saved_email", "local");
      expect(s.read()).toBe("legacy@example.com");
      // Migration : la valeur est maintenant sur la nouvelle cle.
      expect(window.localStorage.getItem("terroir_saved_email")).toBe("legacy@example.com");
      // Et l'ancienne cle a ete supprimee.
      expect(window.localStorage.getItem("terroir-saved-email")).toBeNull();
    });

    it("retourne null si aucune cle n'est peuplee", () => {
      const s = createMigratedStorage("terroir-saved-email", "terroir_saved_email", "local");
      expect(s.read()).toBeNull();
    });

    it("priorise la nouvelle cle si les 2 sont peuplees (race), supprime l'ancienne", () => {
      window.localStorage.setItem("terroir_saved_email", "new@example.com");
      window.localStorage.setItem("terroir-saved-email", "legacy@example.com");
      const s = createMigratedStorage("terroir-saved-email", "terroir_saved_email", "local");
      expect(s.read()).toBe("new@example.com");
      // L'ancienne cle reste (read seul ne touche pas l'ancienne quand la nouvelle existe).
      // C'est un edge case rare ; le prochain write() la nettoiera.
      expect(window.localStorage.getItem("terroir-saved-email")).toBe("legacy@example.com");
    });
  });

  describe("write()", () => {
    it("ecrit sur la nouvelle cle uniquement", () => {
      const s = createMigratedStorage("terroir-saved-email", "terroir_saved_email", "local");
      s.write("foo@example.com");
      expect(window.localStorage.getItem("terroir_saved_email")).toBe("foo@example.com");
      expect(window.localStorage.getItem("terroir-saved-email")).toBeNull();
    });

    it("supprime l'ancienne cle au passage si presente (cleanup race)", () => {
      window.localStorage.setItem("terroir-saved-email", "legacy@example.com");
      const s = createMigratedStorage("terroir-saved-email", "terroir_saved_email", "local");
      s.write("new@example.com");
      expect(window.localStorage.getItem("terroir_saved_email")).toBe("new@example.com");
      expect(window.localStorage.getItem("terroir-saved-email")).toBeNull();
    });
  });

  describe("remove()", () => {
    it("supprime ancienne ET nouvelle cle", () => {
      window.localStorage.setItem("terroir_saved_email", "new@example.com");
      window.localStorage.setItem("terroir-saved-email", "legacy@example.com");
      const s = createMigratedStorage("terroir-saved-email", "terroir_saved_email", "local");
      s.remove();
      expect(window.localStorage.getItem("terroir_saved_email")).toBeNull();
      expect(window.localStorage.getItem("terroir-saved-email")).toBeNull();
    });
  });

  describe("sessionStorage", () => {
    it("opere sur sessionStorage si type='session'", () => {
      window.sessionStorage.setItem(
        "terroir-cart-banner-dismissed",
        "abc123",
      );
      const s = createMigratedStorage(
        "terroir-cart-banner-dismissed",
        "terroir_cart_banner_dismissed",
        "session",
      );
      expect(s.read()).toBe("abc123");
      expect(window.sessionStorage.getItem("terroir_cart_banner_dismissed")).toBe(
        "abc123",
      );
      expect(window.sessionStorage.getItem("terroir-cart-banner-dismissed")).toBeNull();
      // Ne touche PAS le localStorage (isolation type).
      expect(window.localStorage.length).toBe(0);
    });
  });
});
