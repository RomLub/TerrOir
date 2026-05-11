import { describe, it, expect } from "vitest";
import { slugFromEmail } from "@/lib/producers/slug-from-email";

describe("slugFromEmail", () => {
  it("convertit un email standard en slug avec suffixe 6 chars", () => {
    const slug = slugFromEmail("john.doe@example.com");
    expect(slug).toMatch(/^john-doe-[a-z0-9]{6}$/);
  });

  // F-055 (audit pré-launch 2026-05-11) — suffixe randomBytes(3).toString('hex')
  // = 6 caractères hexadécimaux exclusivement (0-9, a-f). Verrouille
  // l'invariant contre une régression accidentelle vers Math.random()
  // (qui peut produire des caractères g-z via base36).
  it("suffixe hex strict (randomBytes(3) — F-055)", () => {
    const slug = slugFromEmail("john.doe@example.com");
    expect(slug).toMatch(/^john-doe-[0-9a-f]{6}$/);
  });

  it("remplace les caractères non-ASCII (accents) par des tirets", () => {
    const slug = slugFromEmail("émile@x.fr");
    expect(slug).toMatch(/^-mile-[a-z0-9]{6}$/);
  });

  it("normalise les majuscules en lowercase", () => {
    const slug = slugFromEmail("Foo.Bar@x.fr");
    expect(slug).toMatch(/^foo-bar-[a-z0-9]{6}$/);
  });

  it("fusionne les caractères spéciaux consécutifs en un seul tiret", () => {
    const slug = slugFromEmail("+_!@x.fr");
    expect(slug).toMatch(/^--[a-z0-9]{6}$/);
  });

  it("génère des suffixes différents sur deux appels successifs", () => {
    const a = slugFromEmail("john@x.fr");
    const b = slugFromEmail("john@x.fr");
    expect(a).not.toBe(b);
  });
});
