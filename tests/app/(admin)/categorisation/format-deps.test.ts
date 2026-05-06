import { describe, it, expect } from "vitest";
import {
  formatDependencyCount,
  formatDeleteBlockedMessage,
  matchesSearch,
} from "@/app/(admin)/categorisation/_lib/format-deps";

// Tests pour les helpers UI partagés des pages /admin/categorisation/* :
// - formatDependencyCount : pluralisation FR + concat products + cuts
// - formatDeleteBlockedMessage : message d'erreur 409 par ressource
// - matchesSearch : filtre local case-insensitive name OU slug

describe("formatDependencyCount", () => {
  it("aucune dépendance → chaîne vide", () => {
    expect(formatDependencyCount({})).toBe("");
    expect(formatDependencyCount({ products: 0, cuts: 0 })).toBe("");
  });

  it("1 produit → singulier", () => {
    expect(formatDependencyCount({ products: 1 })).toBe("1 produit");
  });

  it("3 produits → pluriel", () => {
    expect(formatDependencyCount({ products: 3 })).toBe("3 produits");
  });

  it("1 morceau → singulier 'morceau'", () => {
    expect(formatDependencyCount({ cuts: 1 })).toBe("1 morceau");
  });

  it("5 morceaux → pluriel 'morceaux'", () => {
    expect(formatDependencyCount({ cuts: 5 })).toBe("5 morceaux");
  });

  it("products + cuts simultanés → concat avec ' + '", () => {
    expect(formatDependencyCount({ products: 3, cuts: 5 })).toBe(
      "3 produits + 5 morceaux",
    );
  });

  it("ignore products=0 si cuts > 0", () => {
    expect(formatDependencyCount({ products: 0, cuts: 5 })).toBe(
      "5 morceaux",
    );
  });
});

describe("formatDeleteBlockedMessage — category", () => {
  it("1 produit → 'utilise cette catégorie' singulier", () => {
    const msg = formatDeleteBlockedMessage("category", { products: 1 });
    expect(msg).toContain("1 produit utilise cette catégorie");
  });

  it("3 produits → 'utilisent cette catégorie' pluriel", () => {
    const msg = formatDeleteBlockedMessage("category", { products: 3 });
    expect(msg).toContain("3 produits utilisent cette catégorie");
  });

  it("inclut hint 'Re-tagguer ces produits avant suppression'", () => {
    const msg = formatDeleteBlockedMessage("category", { products: 5 });
    expect(msg).toContain("Re-tagguer");
  });
});

describe("formatDeleteBlockedMessage — animal", () => {
  it("products only → message liés à cette espèce", () => {
    const msg = formatDeleteBlockedMessage("animal", { products: 3 });
    expect(msg).toContain("3 produits");
    expect(msg).toContain("liés à cette espèce");
  });

  it("cuts only → message liés à cette espèce", () => {
    const msg = formatDeleteBlockedMessage("animal", { cuts: 30 });
    expect(msg).toContain("30 morceaux");
    expect(msg).toContain("liés à cette espèce");
  });

  it("products + cuts → les deux mentionnés ensemble", () => {
    const msg = formatDeleteBlockedMessage("animal", {
      products: 3,
      cuts: 5,
    });
    expect(msg).toContain("3 produits");
    expect(msg).toContain("5 morceaux");
  });

  it("1 produit seulement → singulier 'lié'", () => {
    const msg = formatDeleteBlockedMessage("animal", { products: 1 });
    expect(msg).toMatch(/1 produit lié /);
  });

  it("invite à re-tagguer / supprimer", () => {
    const msg = formatDeleteBlockedMessage("animal", { products: 3 });
    expect(msg).toContain("Re-tagguer");
  });
});

describe("formatDeleteBlockedMessage — cut", () => {
  it("3 produits → 'utilisent ce morceau'", () => {
    const msg = formatDeleteBlockedMessage("cut", { products: 3 });
    expect(msg).toContain("3 produits utilisent ce morceau");
  });

  it("1 produit → 'utilise ce morceau' singulier", () => {
    const msg = formatDeleteBlockedMessage("cut", { products: 1 });
    expect(msg).toContain("1 produit utilise ce morceau");
  });
});

describe("formatDeleteBlockedMessage — fallback dégénéré", () => {
  it("aucune dépendance fournie → message neutre 'Suppression impossible.'", () => {
    expect(formatDeleteBlockedMessage("category", {})).toBe(
      "Suppression impossible.",
    );
  });
});

describe("matchesSearch", () => {
  const row = { name: "Bœuf", slug: "boeuf" };

  it("query vide → match tout", () => {
    expect(matchesSearch(row, "")).toBe(true);
    expect(matchesSearch(row, "   ")).toBe(true);
  });

  it("match sur name (case-insensitive)", () => {
    expect(matchesSearch(row, "bœuf")).toBe(true);
    expect(matchesSearch(row, "BŒUF")).toBe(true);
    expect(matchesSearch(row, "ŒUF")).toBe(true);
  });

  it("match sur slug (case-insensitive)", () => {
    expect(matchesSearch(row, "boeuf")).toBe(true);
    expect(matchesSearch(row, "BOEUF")).toBe(true);
    expect(matchesSearch(row, "boe")).toBe(true);
  });

  it("trim de la query", () => {
    expect(matchesSearch(row, "  boeuf  ")).toBe(true);
  });

  it("aucun match → false", () => {
    expect(matchesSearch(row, "porc")).toBe(false);
    expect(matchesSearch(row, "xyz")).toBe(false);
  });
});
