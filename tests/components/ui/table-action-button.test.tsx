// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TableActionButton } from "@/components/ui/table-action-button";

describe("TableActionButton variants — Phase 2 T-111", () => {
  it("variant=primary terroir-green-700 (action default)", () => {
    const html = renderToStaticMarkup(
      <TableActionButton variant="primary">Voir</TableActionButton>,
    );
    expect(html).toContain("bg-terroir-green-700");
  });

  it("variant=success green-700 (validation métier)", () => {
    const html = renderToStaticMarkup(
      <TableActionButton variant="success">Valider</TableActionButton>,
    );
    expect(html).toContain("bg-green-700");
    expect(html).toContain("hover:bg-green-800");
  });

  it("variant=ghost-danger (action destructive)", () => {
    const html = renderToStaticMarkup(
      <TableActionButton variant="ghost-danger">Supprimer</TableActionButton>,
    );
    expect(html).toContain("text-red-700");
  });
});
