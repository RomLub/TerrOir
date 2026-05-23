import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RefundsTabNav } from "@/app/(admin)/_components/RefundsTabNav";

// Chantier 5 — barre d'onglets section Remboursements (Server Component).

function tagFor(html: string, href: string): string | null {
  const idx = html.indexOf(`href="${href}"`);
  if (idx === -1) return null;
  const start = html.lastIndexOf("<a", idx);
  const end = html.indexOf(">", idx);
  return start === -1 || end === -1 ? null : html.substring(start, end + 1);
}

describe("RefundsTabNav", () => {
  it("rend les 2 onglets avec leurs libellés FR + hrefs", () => {
    const html = renderToStaticMarkup(<RefundsTabNav active="demandes" />);
    expect(html).toContain('href="/refunds/pending"');
    expect(html).toContain('href="/refund-incidents"');
    expect(html).toContain("Demandes à arbitrer");
    expect(html).toContain("Incidents techniques");
    expect(html).toContain("Remboursements");
  });

  it("active='demandes' -> aria-current sur /refunds/pending uniquement", () => {
    const html = renderToStaticMarkup(<RefundsTabNav active="demandes" />);
    expect(tagFor(html, "/refunds/pending")).toContain('aria-current="page"');
    expect(tagFor(html, "/refund-incidents")).not.toContain('aria-current="page"');
  });

  it("active='incidents' -> aria-current sur /refund-incidents uniquement", () => {
    const html = renderToStaticMarkup(<RefundsTabNav active="incidents" />);
    expect(tagFor(html, "/refund-incidents")).toContain('aria-current="page"');
    expect(tagFor(html, "/refunds/pending")).not.toContain('aria-current="page"');
  });
});
