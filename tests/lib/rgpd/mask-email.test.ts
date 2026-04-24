import { describe, it, expect } from "vitest";
import { maskEmail } from "@/lib/rgpd/mask-email";

describe("maskEmail", () => {
  it("masque un email normal en préservant 2 chars + domaine", () => {
    expect(maskEmail("julien.dupont@example.com")).toBe("ju***@example.com");
  });

  it("masque un email dont la part locale fait 1 caractère", () => {
    expect(maskEmail("j@example.com")).toBe("j*@example.com");
  });

  it("masque un email dont la part locale fait 2 caractères", () => {
    expect(maskEmail("jb@example.com")).toBe("j*@example.com");
  });

  it("masque un email dont la part locale fait 3 caractères", () => {
    expect(maskEmail("abc@example.com")).toBe("ab***@example.com");
  });

  it("conserve le domaine complet (sous-domaines inclus)", () => {
    expect(maskEmail("alice@mail.sub.example.co.uk")).toBe(
      "al***@mail.sub.example.co.uk",
    );
  });

  it("retourne (none) pour null", () => {
    expect(maskEmail(null)).toBe("(none)");
  });

  it("retourne (none) pour undefined", () => {
    expect(maskEmail(undefined)).toBe("(none)");
  });

  it("retourne (none) pour chaîne vide", () => {
    expect(maskEmail("")).toBe("(none)");
  });

  it("retourne (invalid) pour une chaîne sans @", () => {
    expect(maskEmail("pas-un-email")).toBe("(invalid)");
  });

  it("retourne (invalid) pour un email sans domaine", () => {
    expect(maskEmail("user@")).toBe("(invalid)");
  });

  it("retourne (invalid) pour un email sans part locale", () => {
    expect(maskEmail("@example.com")).toBe("(invalid)");
  });

  it("gère plusieurs @ en ne splittant que sur le premier", () => {
    // Edge case RFC : les @ suivants sont conservés dans le domaine, pas perdus.
    expect(maskEmail("a@b@c.com")).toBe("a*@b@c.com");
  });
});
