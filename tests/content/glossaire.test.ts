import { describe, it, expect } from "vitest";
import {
  GLOSSAIRE_ARTICLES,
  GLOSSAIRE_CATEGORY_LABELS,
  getGlossaireArticleBySlug,
  getGlossaireArticlesByCategory,
} from "@/content/glossaire";

// T-243 — invariants registry glossaire.
//
// Tests minimaux scaffolding (cf. brief Teammate D : "Tests minimaux") :
//   - slug unique global
//   - chaque article référence une catégorie déclarée dans
//     GLOSSAIRE_CATEGORY_LABELS
//   - lookup par slug fonctionne
//   - groupement par catégorie cohérent

describe("glossaire — registry invariants", () => {
  it("slugs uniques sur l'ensemble du registry", () => {
    const slugs = GLOSSAIRE_ARTICLES.map((a) => a.slug);
    const unique = new Set(slugs);
    expect(unique.size).toBe(slugs.length);
  });

  it("chaque article référence une catégorie déclarée", () => {
    const known = Object.keys(GLOSSAIRE_CATEGORY_LABELS);
    for (const a of GLOSSAIRE_ARTICLES) {
      expect(known).toContain(a.category);
    }
  });

  it("getGlossaireArticleBySlug retourne l'article correct", () => {
    const labelRouge = getGlossaireArticleBySlug("label-rouge");
    expect(labelRouge?.title).toBe("Label Rouge");
    expect(labelRouge?.category).toBe("labels");
  });

  it("getGlossaireArticleBySlug retourne null pour slug inconnu", () => {
    expect(getGlossaireArticleBySlug("inexistant")).toBeNull();
  });

  it("getGlossaireArticlesByCategory groupe correctement", () => {
    const grouped = getGlossaireArticlesByCategory();
    expect(Object.keys(grouped)).toEqual([
      "labels",
      "races",
      "modes-elevage",
      "terroirs",
    ]);
    // V0 : 2 seeds dans labels, 0 ailleurs.
    expect(grouped.labels.length).toBeGreaterThanOrEqual(1);
  });

  it("chaque article a un last_updated au format YYYY-MM-DD", () => {
    const re = /^\d{4}-\d{2}-\d{2}$/;
    for (const a of GLOSSAIRE_ARTICLES) {
      expect(a.last_updated).toMatch(re);
    }
  });

  it("chaque article expose un Body composant", () => {
    for (const a of GLOSSAIRE_ARTICLES) {
      expect(typeof a.Body).toBe("function");
    }
  });
});
