import { describe, it, expect } from "vitest";
import { escapeIlikeEmail } from "@/lib/supabase/escape-ilike";

describe("escapeIlikeEmail (T-110-bis)", () => {
  it("ne modifie pas un email sans wildcards (no-op)", () => {
    expect(escapeIlikeEmail("normal@example.com")).toBe("normal@example.com");
    expect(escapeIlikeEmail("john.doe@example.fr")).toBe("john.doe@example.fr");
    expect(escapeIlikeEmail("a+tag@sub.domain.tld")).toBe("a+tag@sub.domain.tld");
  });

  it("échappe l'underscore (Postgres ILIKE wildcard 1 char)", () => {
    expect(escapeIlikeEmail("john_doe@example.com")).toBe(
      "john\\_doe@example.com",
    );
    expect(escapeIlikeEmail("a_b_c@example.com")).toBe("a\\_b\\_c@example.com");
  });

  it("échappe le pourcent (Postgres ILIKE wildcard n chars)", () => {
    expect(escapeIlikeEmail("50%off@example.com")).toBe(
      "50\\%off@example.com",
    );
    expect(escapeIlikeEmail("a%b%c@example.com")).toBe("a\\%b\\%c@example.com");
  });

  it("échappe le backslash (escape character Postgres lui-même)", () => {
    // Backslash en local-part = quoted form RFC 5322. Rare mais possible.
    // Doit être échappé pour ne pas casser le pattern ILIKE.
    expect(escapeIlikeEmail("a\\b@example.com")).toBe("a\\\\b@example.com");
  });

  it("échappe les 3 caractères mélangés sur le même input", () => {
    expect(escapeIlikeEmail("a_b%c\\d@example.com")).toBe(
      "a\\_b\\%c\\\\d@example.com",
    );
  });

  it("retourne chaîne vide pour input vide (edge case)", () => {
    expect(escapeIlikeEmail("")).toBe("");
  });

  it("ne touche pas aux caractères qui ne sont PAS wildcards ILIKE", () => {
    // Ces caractères sont valides en email mais sans signification ILIKE,
    // donc ne doivent PAS être échappés. Régression contre over-escape.
    expect(escapeIlikeEmail("a.b-c+d@example.com")).toBe("a.b-c+d@example.com");
    expect(escapeIlikeEmail("UPPER@CASE.COM")).toBe("UPPER@CASE.COM");
  });

  it("non-idempotent : double escape augmente le nombre de backslashes", () => {
    // Pattern recommandé : escape AVANT .ilike(), UNE seule fois. Doctrine
    // documentée pour éviter une double-application accidentelle.
    const once = escapeIlikeEmail("a_b@example.com");
    const twice = escapeIlikeEmail(once);
    expect(twice.length).toBeGreaterThan(once.length);
    expect(twice).not.toBe(once);
  });
});
