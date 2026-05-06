import { describe, it, expect, vi } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// `DistanceWidget` est un composant client (`"use client"`) qui utilise
// useState/useEffect + lit la geoloc navigateur. On le mocke en stub statique
// pour que `renderToStaticMarkup` reste déterministe et ne dépende pas du
// runtime client. On teste ScoreCarbonBlock isolément ; DistanceWidget a son
// propre périmètre de test.
vi.mock(
  "@/app/(public)/producteurs/[slug]/_components/DistanceWidget",
  () => ({
    DistanceWidget: () => null,
  }),
);

import { ScoreCarbonBlock } from "@/app/(public)/producteurs/[slug]/_components/ScoreCarbonBlock";

// ScoreCarbonBlock est un Server Component synchrone : on l'appelle comme
// une simple fonction et on récupère le ReactElement (ou null) directement.
// Pas besoin de jsdom — env=node + renderToStaticMarkup suffit pour
// asserter la structure HTML statique.

function render(props: Parameters<typeof ScoreCarbonBlock>[0]): string | null {
  const el = ScoreCarbonBlock(props) as ReactElement | null;
  if (el === null) return null;
  return renderToStaticMarkup(el);
}

const BASE_PROPS = {
  modeElevage: null,
  alimentation: null,
  densiteAnimale: null,
  producerLat: null,
  producerLng: null,
  producerName: "Ferme Test",
} as const;

describe("ScoreCarbonBlock — cas limites de rendu", () => {
  it("Cas A : 0 enum + 0 lat/lng → retourne null (pas de moignon)", () => {
    const el = ScoreCarbonBlock({ ...BASE_PROPS });
    expect(el).toBeNull();
  });

  it("Cas B : 0 enum + lat/lng → titre 'chez toi', pas de pills, widget rendu", () => {
    const html = render({
      ...BASE_PROPS,
      producerLat: 48.85,
      producerLng: 2.35,
    });
    expect(html).not.toBeNull();
    const out = html!;
    // Titre adaptatif : version maraîcher (pas d'élevage à montrer).
    expect(out).toContain("de chez toi");
    expect(out).not.toMatch(/de l(&#x27;|')éleveur/);
    // Aucune des 3 catégories ne doit apparaître en eyebrow.
    expect(out).not.toContain("Mode d&#x27;élevage");
    expect(out).not.toContain("Mode d'élevage");
    expect(out).not.toContain("Alimentation");
    expect(out).not.toContain("Densité animale");
    // Le label "Distance ferme → toi" introduit le widget distance.
    expect(out).toContain("Distance ferme");
  });

  it("Cas C : 1 seul enum saisi → 1 pill seulement, pas de moignon pour les 2 autres", () => {
    const html = render({
      ...BASE_PROPS,
      modeElevage: "plein_air",
    });
    expect(html).not.toBeNull();
    const out = html!;
    // Titre version éleveur dès qu'un enum est saisi.
    expect(out).toMatch(/de l(&#x27;|')éleveur/);
    // L'eyebrow Mode d'élevage est présent (HTML échappe l'apostrophe en &#x27;).
    expect(out).toMatch(/Mode d(&#x27;|')élevage/);
    // Les 2 autres catégories ne doivent PAS apparaître (pas de moignon).
    expect(out).not.toContain("Alimentation");
    expect(out).not.toContain("Densité animale");
    // Le label public "Plein air" doit être rendu.
    expect(out).toContain("Plein air");
    // Pas de widget distance (lat/lng absents).
    expect(out).not.toContain("Distance ferme");
  });

  it("Cas D : 2 enums saisis → 2 pills seulement, pas la 3e", () => {
    const html = render({
      ...BASE_PROPS,
      modeElevage: "plein_air",
      alimentation: "pature_dominante",
    });
    expect(html).not.toBeNull();
    const out = html!;
    expect(out).toMatch(/de l(&#x27;|')éleveur/);
    expect(out).toMatch(/Mode d(&#x27;|')élevage/);
    expect(out).toContain("Alimentation");
    // La 3e catégorie est absente.
    expect(out).not.toContain("Densité animale");
    // Labels publics présents pour les 2 enums saisis.
    expect(out).toContain("Plein air");
    expect(out).toContain("Surtout à l&#x27;herbe"); // ALIMENTATION_PUBLIC_LABELS.pature_dominante
  });

  it("Cas E : 3 enums + lat/lng → 3 pills + widget + titre 'éleveur'", () => {
    const html = render({
      ...BASE_PROPS,
      modeElevage: "plein_air",
      alimentation: "pature_dominante",
      densiteAnimale: "extensive",
      producerLat: 48.85,
      producerLng: 2.35,
    });
    expect(html).not.toBeNull();
    const out = html!;
    expect(out).toMatch(/de l(&#x27;|')éleveur/);
    expect(out).toMatch(/Mode d(&#x27;|')élevage/);
    expect(out).toContain("Alimentation");
    expect(out).toContain("Densité animale");
    expect(out).toContain("Plein air");
    expect(out).toContain("Surtout à l&#x27;herbe");
    expect(out).toContain("Beaucoup d&#x27;espace"); // DENSITE_ANIMALE_PUBLIC_LABELS.extensive
    expect(out).toContain("Distance ferme");
  });
});

describe("ScoreCarbonBlock — pas de tooltip natif sur les pills (T-200 r2)", () => {
  // Décision comité review T-200 round 2 : le `title` natif a été retiré des
  // pills (mauvais comportement sur mobile, redondant avec le hint affiché en
  // clair). On verrouille ici par un smoke contre une régression accidentelle.

  it("aucune pill .rounded-full ne porte d'attribut title", () => {
    const html = render({
      ...BASE_PROPS,
      modeElevage: "plein_air",
      alimentation: "pature_dominante",
      densiteAnimale: "extensive",
    });
    expect(html).not.toBeNull();
    const out = html!;
    // Match toutes les balises <span ...> qui contiennent rounded-full ; on
    // s'assure qu'aucune ne déclare title="...".
    const pillSpans = out.match(/<span\b[^>]*\brounded-full\b[^>]*>/g) ?? [];
    expect(pillSpans.length).toBeGreaterThan(0); // sanity : on a bien des pills
    for (const span of pillSpans) {
      expect(span).not.toMatch(/\btitle=/);
    }
  });
});
