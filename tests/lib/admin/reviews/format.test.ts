import { describe, it, expect } from "vitest";
import {
  formatReviewDate,
  mapPendingReview,
  mapReviewWithResponse,
} from "@/lib/admin/reviews/format";
import type {
  ReviewPendingDbRow,
  ReviewWithResponseDbRow,
} from "@/lib/admin/reviews/types";

// Tests des helpers de mapping pure (pas d'I/O). Couvre :
// - formatReviewDate : ISO → locale FR ; fallback si parsing invalide.
// - mapPendingReview : auteur "Prénom N." + fallback Anonyme + tolérance
//   array/objet sur embed PostgREST.
// - mapReviewWithResponse : hérite mapPendingReview + champs réponse.

describe("formatReviewDate", () => {
  it("formate une ISO valide en locale FR", () => {
    const out = formatReviewDate("2026-05-13T10:00:00.000Z");
    // Locale fr-FR : "13 mai 2026" (l'abréviation 'mai' n'a pas de point en
    // fr-FR pour ce mois ; le test reste tolérant aux variantes Intl).
    expect(out).toMatch(/13/);
    expect(out).toMatch(/2026/);
  });

  it("fallback sur la string brute si parsing invalide", () => {
    expect(formatReviewDate("pas-une-date")).toBe("pas-une-date");
  });
});

describe("mapPendingReview", () => {
  const base: ReviewPendingDbRow = {
    id: "r1",
    note: 4,
    commentaire: "très bon",
    created_at: "2026-05-13T10:00:00.000Z",
    consumer: { prenom: "Jean", nom: "Dupont" },
    producer: { nom_exploitation: "Ferme du Test", slug: "ferme-du-test" },
  };

  it("construit auteur Prénom N. quand prenom + nom présents", () => {
    const row = mapPendingReview(base);
    expect(row.author).toBe("Jean D.");
    expect(row.rating).toBe(4);
    expect(row.comment).toBe("très bon");
    expect(row.producer).toBe("Ferme du Test");
    expect(row.producerSlug).toBe("ferme-du-test");
  });

  it("tolère embed PostgREST en array", () => {
    const row = mapPendingReview({
      ...base,
      consumer: [{ prenom: "Marie", nom: "Curie" }],
      producer: [{ nom_exploitation: "X", slug: "x" }],
    });
    expect(row.author).toBe("Marie C.");
    expect(row.producer).toBe("X");
  });

  it("fallback Anonyme si consumer null", () => {
    const row = mapPendingReview({ ...base, consumer: null });
    expect(row.author).toBe("Anonyme");
  });

  it("fallback Anonyme si prenom + nom tous null", () => {
    const row = mapPendingReview({
      ...base,
      consumer: { prenom: null, nom: null },
    });
    expect(row.author).toBe("Anonyme");
  });

  it("juste prenom sans nom → pas d'initiale", () => {
    const row = mapPendingReview({
      ...base,
      consumer: { prenom: "Solo", nom: null },
    });
    expect(row.author).toBe("Solo");
  });

  it("commentaire null → string vide", () => {
    const row = mapPendingReview({ ...base, commentaire: null });
    expect(row.comment).toBe("");
  });

  it("producer null → tirets et slug vide", () => {
    const row = mapPendingReview({ ...base, producer: null });
    expect(row.producer).toBe("—");
    expect(row.producerSlug).toBe("");
  });
});

describe("mapReviewWithResponse", () => {
  const row: ReviewWithResponseDbRow = {
    id: "r2",
    note: 5,
    commentaire: "génial",
    created_at: "2026-05-10T10:00:00.000Z",
    consumer: { prenom: "Sophie", nom: "Martin" },
    producer: { nom_exploitation: "Ferme A", slug: "ferme-a" },
    producer_response: "Merci !",
    producer_response_at: "2026-05-11T11:00:00.000Z",
    producer_response_status: "published",
  };

  it("hérite mapPendingReview + ajoute champs réponse", () => {
    const out = mapReviewWithResponse(row);
    expect(out.author).toBe("Sophie M.");
    expect(out.response).toBe("Merci !");
    expect(out.responseStatus).toBe("published");
    expect(out.responseAt).toMatch(/2026/);
  });
});
