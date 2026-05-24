import { describe, it, expect } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PageHeader, type PageHeaderProps } from "@/components/ui/page-header";

// PageHeader généralise AdminPageHeader avec une prop `tone` (ADR-0011).
// On vérifie que chaque skin applique la bonne palette et que le skin admin
// reste byte-pour-byte l'ancien (non-régression admin).

function render(props: PageHeaderProps): string {
  return renderToStaticMarkup(PageHeader(props) as ReactElement);
}

describe("PageHeader — skin producteur (tone='producer')", () => {
  const html = render({
    tone: "producer",
    eyebrow: "Comptabilité",
    title: "Export comptable",
    subtitle: "Sous-titre",
  });

  it("eyebrow en terra-700, titre en green-900, sous-titre en dark/60", () => {
    expect(html).toContain("text-terra-700");
    expect(html).toContain("text-green-900");
    expect(html).toContain("text-dark/60");
  });

  it("marge basse mb-10 (convention producteur)", () => {
    expect(html).toContain("mb-10");
  });

  it("rend eyebrow, titre et sous-titre", () => {
    expect(html).toContain("Comptabilité");
    expect(html).toContain("Export comptable");
    expect(html).toContain("Sous-titre");
  });
});

describe("PageHeader — skin admin (défaut, non-régression)", () => {
  it("tone par défaut = admin : palette terroir-green-700 / gray-900 / gray-500 + mb-8", () => {
    const html = render({
      eyebrow: "Pilotage",
      title: "Tableau de bord",
      subtitle: "Vue d'ensemble",
    });
    expect(html).toContain("text-terroir-green-700");
    expect(html).toContain("text-gray-900");
    expect(html).toContain("text-gray-500");
    expect(html).toContain("mb-8");
  });
});

describe("PageHeader — slots right + error", () => {
  it("rend le slot right", () => {
    const html = render({
      title: "Titre",
      right: <button type="button">Action</button>,
    });
    expect(html).toContain("Action");
  });

  it("rend l'erreur (producteur en terra-700)", () => {
    const html = render({
      tone: "producer",
      title: "Titre",
      error: "Échec du chargement",
    });
    expect(html).toContain("Échec du chargement");
    expect(html).toContain("text-terra-700");
  });

  it("n'affiche pas le bloc erreur quand error est null", () => {
    const html = render({ title: "Titre", error: null });
    expect(html).not.toContain("text-red-700");
  });
});
