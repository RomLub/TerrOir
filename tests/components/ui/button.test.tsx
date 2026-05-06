// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "@/components/ui/button";

describe("Button variants — Phase 2 T-111", () => {
  it("variant=primary rend la classe terra-700 (CTA métier)", () => {
    const html = renderToStaticMarkup(<Button variant="primary">CTA</Button>);
    expect(html).toContain("bg-terra-700");
    expect(html).toContain("hover:bg-terra-800");
  });

  it("variant=success rend la classe green-700 (validation métier)", () => {
    const html = renderToStaticMarkup(<Button variant="success">OK</Button>);
    expect(html).toContain("bg-green-700");
    expect(html).toContain("hover:bg-green-800");
  });

  it("variant=accent legacy reste rendable (back-compat)", () => {
    const html = renderToStaticMarkup(<Button variant="accent">Legacy</Button>);
    expect(html).toContain("bg-green-700");
  });

  it("variant=secondary terra-100 (action secondaire)", () => {
    const html = renderToStaticMarkup(
      <Button variant="secondary">Voir plus</Button>,
    );
    expect(html).toContain("bg-terra-100");
    expect(html).toContain("text-terra-700");
  });

  it("variant=ghost transparent (action tertiaire)", () => {
    const html = renderToStaticMarkup(
      <Button variant="ghost">Annuler</Button>,
    );
    expect(html).toContain("bg-transparent");
  });

  it("default sans variant = primary", () => {
    const html = renderToStaticMarkup(<Button>Default</Button>);
    expect(html).toContain("bg-terra-700");
  });
});
