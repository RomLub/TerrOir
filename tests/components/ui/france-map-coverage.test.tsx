import { describe, it, expect } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FranceMapCoverage } from "@/components/ui/france-map-coverage";
import { FRANCE_DEPARTEMENTS } from "@/lib/geo/france-departements";

// FranceMapCoverage est un Server Component synchrone — on l'appelle
// comme une fonction et on rend en static markup. Cohérent avec le pattern
// score-carbon-block.test.tsx (env=node, pas de jsdom).

function render(
  props: Parameters<typeof FranceMapCoverage>[0],
): string {
  const el = FranceMapCoverage(props) as ReactElement;
  return renderToStaticMarkup(el);
}

describe("FranceMapCoverage — rendu SVG", () => {
  it("rend un SVG avec un rect par département (96 cellules)", () => {
    const html = render({
      coveredDepartments: [],
      departmentProducerCounts: {},
    });
    // Compte les <rect> avec data-dept="..."
    const matches = html.match(/data-dept="\d{2}|data-dept="2[AB]"/g);
    // Plus simple : compter les occurrences de data-dept=
    const rectCount = (html.match(/data-dept=/g) ?? []).length;
    expect(rectCount).toBe(FRANCE_DEPARTEMENTS.length);
    expect(matches).toBeTruthy();
  });

  it("départements couverts : data-covered=\"1\"", () => {
    const html = render({
      coveredDepartments: ["72", "49"],
      departmentProducerCounts: { "72": 3, "49": 1 },
    });
    expect(html).toContain('data-dept="72" data-covered="1"');
    expect(html).toContain('data-dept="49" data-covered="1"');
  });

  it("départements non couverts : data-covered=\"0\"", () => {
    const html = render({
      coveredDepartments: ["72"],
      departmentProducerCounts: { "72": 1 },
    });
    expect(html).toContain('data-dept="13" data-covered="0"');
    expect(html).toContain('data-dept="2A" data-covered="0"');
  });

  it("tooltip via <title> SVG : nom + count pour les couverts", () => {
    const html = render({
      coveredDepartments: ["72"],
      departmentProducerCounts: { "72": 3 },
    });
    expect(html).toContain("<title>Sarthe (72) — 3 producteurs</title>");
  });

  it("tooltip singulier 1 producteur (pas de pluriel)", () => {
    const html = render({
      coveredDepartments: ["72"],
      departmentProducerCounts: { "72": 1 },
    });
    expect(html).toContain("<title>Sarthe (72) — 1 producteur</title>");
  });

  it("tooltip département non couvert : 'Pas encore de producteur'", () => {
    const html = render({
      coveredDepartments: [],
      departmentProducerCounts: {},
    });
    expect(html).toContain(
      "<title>Sarthe (72) — Pas encore de producteur</title>",
    );
  });

  it("légende rendue : 'Producteurs disponibles' + 'Pas encore couvert'", () => {
    const html = render({
      coveredDepartments: ["72"],
      departmentProducerCounts: { "72": 1 },
    });
    expect(html).toContain("Producteurs disponibles");
    expect(html).toContain("Pas encore couvert");
  });

  it("département couvert : fill terra (#A0522D)", () => {
    const html = render({
      coveredDepartments: ["72"],
      departmentProducerCounts: { "72": 1 },
    });
    // Le rect 72 doit avoir fill="#A0522D"
    expect(html).toMatch(/fill="#A0522D"[^>]*data-dept="72"|data-dept="72"[^>]*fill="#A0522D"/);
  });

  it("département non couvert : fill stone (#E7E5E4)", () => {
    const html = render({
      coveredDepartments: [],
      departmentProducerCounts: {},
    });
    expect(html).toMatch(/fill="#E7E5E4"[^>]*data-dept="72"|data-dept="72"[^>]*fill="#E7E5E4"/);
  });

  it("CSS hover scoped injecté dans <style>", () => {
    const html = render({
      coveredDepartments: ["72"],
      departmentProducerCounts: { "72": 1 },
    });
    // React 19 : renderToStaticMarkup ne ré-escape plus les " dans <style>
    // (vs React 18 qui les sortait en &quot;). Le navigateur les interprète
    // correctement dans les deux cas — le test vérifie juste que le sélecteur
    // est bien présent.
    expect(html).toContain('rect[data-covered="1"]:hover');
    expect(html).toContain('rect[data-covered="0"]:hover');
  });
});
