import { describe, it, expect } from "vitest";
import { cookieConfigForHost } from "@/lib/supabase/cookie-domain";

// `cookieConfigForHost` est pure : aucune dépendance runtime, pas de mock.
// Rappel du contrat (cf. lib/supabase/cookie-domain.ts) :
//   - admin.*  → name 'sb-admin-auth-token', pas de domain
//   - apex / www / pro sous terroir-local.fr → domain '.terroir-local.fr'
//   - tout le reste (localhost, etc.) → {}

describe("cookieConfigForHost — admin isolation (prod)", () => {
  it("admin.terroir-local.fr → sb-admin-auth-token sans domain", () => {
    expect(cookieConfigForHost("admin.terroir-local.fr")).toEqual({
      name: "sb-admin-auth-token",
    });
  });

  it("admin.* prime sur le matching apex (pas de domain partagé posé)", () => {
    const cfg = cookieConfigForHost("admin.terroir-local.fr");
    expect(cfg.domain).toBeUndefined();
  });
});

describe("cookieConfigForHost — shared cookie apex (www/pro/apex)", () => {
  it("www.terroir-local.fr → domain partagé", () => {
    expect(cookieConfigForHost("www.terroir-local.fr")).toEqual({
      domain: ".terroir-local.fr",
    });
  });

  it("pro.terroir-local.fr → domain partagé", () => {
    expect(cookieConfigForHost("pro.terroir-local.fr")).toEqual({
      domain: ".terroir-local.fr",
    });
  });

  it("apex terroir-local.fr → domain partagé", () => {
    expect(cookieConfigForHost("terroir-local.fr")).toEqual({
      domain: ".terroir-local.fr",
    });
  });
});

describe("cookieConfigForHost — localhost (dev)", () => {
  it("localhost → {} (defaults Supabase)", () => {
    expect(cookieConfigForHost("localhost")).toEqual({});
  });

  it("pro.localhost → {} (defaults Supabase)", () => {
    expect(cookieConfigForHost("pro.localhost")).toEqual({});
  });

  it("admin.localhost → sb-admin-auth-token (isolation testable en dev)", () => {
    expect(cookieConfigForHost("admin.localhost")).toEqual({
      name: "sb-admin-auth-token",
    });
  });
});

describe("cookieConfigForHost — robustesse parsing", () => {
  it("strip port (admin.terroir-local.fr:3000 → admin match)", () => {
    expect(cookieConfigForHost("admin.terroir-local.fr:3000")).toEqual({
      name: "sb-admin-auth-token",
    });
  });

  it("strip port (www.terroir-local.fr:443 → apex match)", () => {
    expect(cookieConfigForHost("www.terroir-local.fr:443")).toEqual({
      domain: ".terroir-local.fr",
    });
  });

  it("case-insensitive : ADMIN.TERROIR-LOCAL.FR", () => {
    expect(cookieConfigForHost("ADMIN.TERROIR-LOCAL.FR")).toEqual({
      name: "sb-admin-auth-token",
    });
  });

  it("case-insensitive : WWW.Terroir-Local.fr", () => {
    expect(cookieConfigForHost("WWW.Terroir-Local.fr")).toEqual({
      domain: ".terroir-local.fr",
    });
  });
});

describe("cookieConfigForHost — entrées vides", () => {
  it("null → {}", () => {
    expect(cookieConfigForHost(null)).toEqual({});
  });

  it("undefined → {}", () => {
    expect(cookieConfigForHost(undefined)).toEqual({});
  });

  it('chaîne vide "" → {}', () => {
    expect(cookieConfigForHost("")).toEqual({});
  });
});

describe("cookieConfigForHost — domaines tiers (defense in depth)", () => {
  it("domaine non-apex ne reçoit pas le domain partagé", () => {
    // Si un hostname contient "terroir-local.fr" en substring mais pas en
    // suffix, on ne doit surtout pas poser le cookie partagé dessus.
    expect(cookieConfigForHost("terroir-local.fr.attacker.com")).toEqual({});
  });

  it("sous-domaine non-admin d'un autre apex → {}", () => {
    expect(cookieConfigForHost("www.autresite.fr")).toEqual({});
  });
});
