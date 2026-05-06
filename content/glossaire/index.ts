// T-243 Glossaire du terroir — registry des articles.
//
// Convention scaffolding (cf. docs/conventions/glossaire.md) :
//   - Pas de runtime MDX pour V0 (évite ajout dépendance lourde +
//     arbitrage pré-Live). Articles = composants Server React + frontmatter
//     statique. Migration MDX possible plus tard sans casse de l'API.
//   - Catégories closed-list (`labels`, `races`, `modes-elevage`,
//     `terroirs`) — ajout = update enum + ajout entry.
//   - 1-2 articles seed pour V0 (label-rouge, agriculture-biologique).
//     Cycles rédactionnels ultérieurs alimentent.

import type { ComponentType } from "react";
import { LabelRougeBody } from "./labels/label-rouge";
import { AgricultureBiologiqueBody } from "./labels/agriculture-biologique";

export type GlossaireCategory =
  | "labels"
  | "races"
  | "modes-elevage"
  | "terroirs";

export const GLOSSAIRE_CATEGORY_LABELS: Record<GlossaireCategory, string> = {
  labels: "Labels et signes officiels",
  races: "Races et variétés",
  "modes-elevage": "Modes d'élevage",
  terroirs: "Terroirs sarthois",
};

export type GlossaireArticleMeta = {
  slug: string;
  title: string;
  category: GlossaireCategory;
  excerpt: string;
  tags: readonly string[];
  last_updated: string; // YYYY-MM-DD
  sources: readonly { label: string; url?: string }[];
};

export type GlossaireArticle = GlossaireArticleMeta & {
  Body: ComponentType;
};

// Registry plat — V0 contient 1 article par catégorie max. Cycles
// rédactionnels suivants viennent étendre ce registre.
export const GLOSSAIRE_ARTICLES: readonly GlossaireArticle[] = [
  {
    slug: "label-rouge",
    title: "Label Rouge",
    category: "labels",
    excerpt:
      "Signe officiel français de qualité supérieure attaché à un cahier des charges précis : conditions d'élevage, alimentation, traçabilité.",
    tags: ["qualité", "officiel", "INAO"],
    last_updated: "2026-05-07",
    sources: [
      {
        label: "INAO — Institut national de l'origine et de la qualité",
        url: "https://www.inao.gouv.fr",
      },
    ],
    Body: LabelRougeBody,
  },
  {
    slug: "agriculture-biologique",
    title: "Agriculture biologique (AB)",
    category: "labels",
    excerpt:
      "Mode de production encadré par un règlement européen : pas de pesticides de synthèse, rotation des cultures, bien-être animal renforcé.",
    tags: ["bio", "officiel", "Europe"],
    last_updated: "2026-05-07",
    sources: [
      {
        label: "Agence BIO — Agence française pour le développement de l'agriculture biologique",
        url: "https://www.agencebio.org",
      },
    ],
    Body: AgricultureBiologiqueBody,
  },
];

export function getGlossaireArticleBySlug(
  slug: string,
): GlossaireArticle | null {
  return GLOSSAIRE_ARTICLES.find((a) => a.slug === slug) ?? null;
}

export function getGlossaireArticlesByCategory(): Record<
  GlossaireCategory,
  GlossaireArticle[]
> {
  const out: Record<GlossaireCategory, GlossaireArticle[]> = {
    labels: [],
    races: [],
    "modes-elevage": [],
    terroirs: [],
  };
  for (const a of GLOSSAIRE_ARTICLES) {
    out[a.category].push(a);
  }
  return out;
}
