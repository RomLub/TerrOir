import { describe, it, expect } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ScoreCarbonPreview } from "@/components/producer/ScoreCarbonPreview";

// ScoreCarbonPreview est un Client Component sans hooks ni effets : on
// l'appelle comme une simple fonction et on rend en static markup.
// Cohérent avec le pattern score-carbon-block.test.tsx — env=node, pas
// besoin de jsdom (composant 100% props-driven).

function render(props: Parameters<typeof ScoreCarbonPreview>[0]): string {
  const el = ScoreCarbonPreview(props) as ReactElement;
  return renderToStaticMarkup(el);
}

const EMPTY = {
  modeElevage: null,
  alimentation: null,
  densiteAnimale: null,
} as const;

describe("ScoreCarbonPreview — placeholder neutre", () => {
  it("aucune valeur : affiche le placeholder + invite à sélectionner", () => {
    const html = render(EMPTY);
    expect(html).toContain("Sélectionnez les options");
    expect(html).toContain("aperçu de votre fiche publique");
    // Aucune des 3 catégories ne doit apparaître quand rien n'est saisi.
    expect(html).not.toContain("Mode d&#x27;élevage");
    expect(html).not.toContain("Mode d'élevage");
    expect(html).not.toContain("Alimentation");
    expect(html).not.toContain("Densité animale");
  });

  it("aucune valeur : pas de badge 'En direct' affiché", () => {
    const html = render(EMPTY);
    expect(html).not.toContain("En direct");
  });

  it("aucune valeur : data-testid placeholder présent (ancrage E2E/QA)", () => {
    const html = render(EMPTY);
    expect(html).toContain('data-testid="score-carbon-preview-placeholder"');
  });
});

describe("ScoreCarbonPreview — rendu partiel (1 ou 2 enums)", () => {
  it("1 seul enum (mode_elevage) : 1 pill, les 2 autres absentes", () => {
    const html = render({
      modeElevage: "plein_air",
      alimentation: null,
      densiteAnimale: null,
    });
    // Eyebrow + label public présents pour mode_elevage.
    expect(html).toMatch(/Mode d(&#x27;|')élevage/);
    expect(html).toContain("Plein air");
    // Les 2 autres catégories absentes — pas de moignon.
    expect(html).not.toContain("Alimentation");
    expect(html).not.toContain("Densité animale");
    // Plus de placeholder dès qu'on a au moins 1 valeur.
    expect(html).not.toContain("Sélectionnez les options");
  });

  it("2 enums saisis : 2 pills, la 3e absente", () => {
    const html = render({
      modeElevage: "semi_plein_air",
      alimentation: "pature_dominante",
      densiteAnimale: null,
    });
    expect(html).toMatch(/Mode d(&#x27;|')élevage/);
    expect(html).toContain("Alimentation");
    // La 3e absente.
    expect(html).not.toContain("Densité animale");
    // PUBLIC_LABELS rendus.
    expect(html).toContain("Semi-plein air");
    expect(html).toContain("Surtout à l&#x27;herbe");
  });
});

describe("ScoreCarbonPreview — rendu complet (3 enums)", () => {
  it("3 enums : 3 pills + ordre cohérent (mode → alim → densité)", () => {
    const html = render({
      modeElevage: "plein_air",
      alimentation: "pature_dominante",
      densiteAnimale: "extensive",
    });
    expect(html).toMatch(/Mode d(&#x27;|')élevage/);
    expect(html).toContain("Alimentation");
    expect(html).toContain("Densité animale");

    // PUBLIC_LABELS exactement (cohérent avec ScoreCarbonBlock côté fiche).
    expect(html).toContain("Plein air");
    expect(html).toContain("Surtout à l&#x27;herbe");
    expect(html).toContain("Beaucoup d&#x27;espace");

    // Ordre : mode_elevage avant alimentation avant densite_animale.
    const idxMode = html.search(/Mode d(&#x27;|')élevage/);
    const idxAlim = html.indexOf("Alimentation");
    const idxDensite = html.indexOf("Densité animale");
    expect(idxMode).toBeGreaterThanOrEqual(0);
    expect(idxAlim).toBeGreaterThan(idxMode);
    expect(idxDensite).toBeGreaterThan(idxAlim);

    // Badge "En direct" dès qu'une valeur est saisie.
    expect(html).toContain("En direct");
  });

  it("densité 'intensive' : tonalité orange (régression visuelle)", () => {
    const html = render({
      modeElevage: null,
      alimentation: null,
      densiteAnimale: "intensive",
    });
    // Le tone DENSITE_TONE.intensive est `bg-orange-100 text-orange-700`.
    expect(html).toContain("bg-orange-100");
    expect(html).toContain("text-orange-700");
    expect(html).toContain("Élevage dense");
  });

  it("densité 'standard' : tonalité terra (régression visuelle)", () => {
    const html = render({
      modeElevage: null,
      alimentation: null,
      densiteAnimale: "standard",
    });
    expect(html).toContain("bg-terroir-terra-100");
    expect(html).toContain("text-terroir-terra-700");
    expect(html).toContain("Espace standard");
  });
});

describe("ScoreCarbonPreview — a11y (anticipation T-215)", () => {
  it("aria-live='polite' sur le conteneur : annoncer maj aux lecteurs d'écran", () => {
    const html = render(EMPTY);
    expect(html).toContain('aria-live="polite"');
  });

  it("pas de title natif sur les pills (cohérence T-200 r2)", () => {
    const html = render({
      modeElevage: "plein_air",
      alimentation: "pature_dominante",
      densiteAnimale: "extensive",
    });
    const pillSpans = html.match(/<span\b[^>]*\brounded-full\b[^>]*>/g) ?? [];
    expect(pillSpans.length).toBeGreaterThan(0);
    for (const span of pillSpans) {
      expect(span).not.toMatch(/\btitle=/);
    }
  });
});

describe("ScoreCarbonPreview — snapshots de régression", () => {
  it("snapshot vide", () => {
    expect(render(EMPTY)).toMatchSnapshot();
  });

  it("snapshot complet (3 enums saisis)", () => {
    expect(
      render({
        modeElevage: "plein_air",
        alimentation: "pature_dominante",
        densiteAnimale: "extensive",
      }),
    ).toMatchSnapshot();
  });
});
