import { describe, it, expect, vi } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// AdminSidebar utilise usePathname() de next/navigation. On le mocke pour
// pouvoir simuler la route active sans router context. Pas de jsdom : la
// sidebar n'a pas d'effet stateful / hooks (juste usePathname read-only).

let currentPathname: string | null = "/tableau-de-bord";
vi.mock("next/navigation", () => ({
  usePathname: () => currentPathname,
}));

import { AdminSidebar } from "@/app/(admin)/_components/AdminSidebar";

function render(): string {
  const el = AdminSidebar() as ReactElement;
  return renderToStaticMarkup(el);
}

// Helper : extrait la balise <a ...> qui matche un href donné, retourne
// la chaîne complète des attributs. Évite les pièges de l'ordre des
// attributs en sortie React (aria-current peut venir AVANT href dans le
// markup, ce qui casse les regex naïves "href=...aria-current=").
function getLinkOpenTag(html: string, href: string): string | null {
  const hrefIdx = html.indexOf(`href="${href}"`);
  if (hrefIdx === -1) return null;
  const tagStart = html.lastIndexOf("<a", hrefIdx);
  const tagEnd = html.indexOf(">", hrefIdx);
  if (tagStart === -1 || tagEnd === -1) return null;
  return html.substring(tagStart, tagEnd + 1);
}

function isActive(html: string, href: string): boolean {
  const tag = getLinkOpenTag(html, href);
  if (!tag) return false;
  return tag.includes('aria-current="page"');
}

describe("AdminSidebar — entrées Catégorisation produits (T-130)", () => {
  it("rend les 3 sous-entrées Catégories / Espèces animales / Morceaux", () => {
    currentPathname = "/tableau-de-bord";
    const html = render();
    expect(html).toContain("/categorisation/categories");
    expect(html).toContain("/categorisation/animaux");
    expect(html).toContain("/categorisation/morceaux");
    expect(html).toContain("Catégories");
    expect(html).toContain("Espèces animales");
    expect(html).toContain("Morceaux");
  });

  it("rend le label de groupe 'Catégorisation produits'", () => {
    const html = render();
    expect(html).toContain("Catégorisation produits");
    // Le group header est un <li role="presentation"> non cliquable
    expect(html).toMatch(
      /<li[^>]*role="presentation"[^>]*>Catégorisation produits<\/li>/,
    );
  });

  it("active state sur /categorisation/categories", () => {
    currentPathname = "/categorisation/categories";
    const html = render();
    expect(isActive(html, "/categorisation/categories")).toBe(true);
    expect(isActive(html, "/categorisation/animaux")).toBe(false);
    expect(isActive(html, "/categorisation/morceaux")).toBe(false);
  });

  it("active state sur /categorisation/animaux", () => {
    currentPathname = "/categorisation/animaux";
    const html = render();
    expect(isActive(html, "/categorisation/animaux")).toBe(true);
    expect(isActive(html, "/categorisation/categories")).toBe(false);
    expect(isActive(html, "/categorisation/morceaux")).toBe(false);
  });

  it("active state sur /categorisation/morceaux", () => {
    currentPathname = "/categorisation/morceaux";
    const html = render();
    expect(isActive(html, "/categorisation/morceaux")).toBe(true);
  });

  it("entrée existante (Tableau de bord) reste fonctionnelle après refacto NAV", () => {
    currentPathname = "/tableau-de-bord";
    const html = render();
    expect(html).toContain("/tableau-de-bord");
    expect(html).toContain("Tableau de bord");
    expect(isActive(html, "/tableau-de-bord")).toBe(true);
  });

  it("toutes les entrées historiques sont préservées (smoke check non-régression)", () => {
    currentPathname = "/tableau-de-bord";
    const html = render();
    for (const href of [
      "/tableau-de-bord",
      "/producer-interests",
      "/gestion-producteurs",
      "/suivi-commandes",
      "/audit-logs",
      "/avis",
      "/legal-compliance",
      "/gms-prices",
    ]) {
      expect(html).toContain(href);
    }
  });
});

describe("AdminSidebar — PR3 admin-new-surfaces (3 nouvelles entrées)", () => {
  it("rend les 3 nouvelles entrées /invitations /users /refund-incidents avec leurs labels", () => {
    currentPathname = "/tableau-de-bord";
    const html = render();
    expect(html).toContain('href="/invitations"');
    expect(html).toContain('href="/users"');
    expect(html).toContain('href="/refund-incidents"');
    expect(html).toContain("Invitations");
    expect(html).toContain("Utilisateurs");
    expect(html).toContain("Incidents refund");
  });

  it("active state sur /users", () => {
    currentPathname = "/users";
    const html = render();
    expect(isActive(html, "/users")).toBe(true);
    expect(isActive(html, "/invitations")).toBe(false);
    expect(isActive(html, "/refund-incidents")).toBe(false);
  });

  it("active state sur /refund-incidents", () => {
    currentPathname = "/refund-incidents";
    const html = render();
    expect(isActive(html, "/refund-incidents")).toBe(true);
  });

  it("active state sur /invitations (et sous-routes)", () => {
    currentPathname = "/invitations";
    const html = render();
    expect(isActive(html, "/invitations")).toBe(true);
  });
});

describe("AdminSidebar — regroupement Référentiels (chantier 7)", () => {
  it("rend le group header 'Référentiels' (non cliquable)", () => {
    currentPathname = "/tableau-de-bord";
    const html = render();
    expect(html).toContain("Référentiels");
    expect(html).toMatch(
      /<li[^>]*role="presentation"[^>]*>Référentiels<\/li>/,
    );
  });

  it("Données GMS (/gms-prices) est rangé sous Référentiels", () => {
    currentPathname = "/tableau-de-bord";
    const html = render();
    // Le group header Référentiels précède l'item Données GMS dans le markup.
    const groupIdx = html.indexOf("Référentiels");
    const gmsIdx = html.indexOf('href="/gms-prices"');
    expect(groupIdx).toBeGreaterThanOrEqual(0);
    expect(gmsIdx).toBeGreaterThan(groupIdx);
    expect(html).toContain("Données GMS");
  });

  it("Catégorisation produits devient un sous-en-tête imbriqué sous Référentiels", () => {
    currentPathname = "/tableau-de-bord";
    const html = render();
    const groupIdx = html.indexOf("Référentiels");
    const subgroupIdx = html.indexOf("Catégorisation produits");
    // Le sous-en-tête vient après le group header parent (nesting préservé).
    expect(subgroupIdx).toBeGreaterThan(groupIdx);
    // Toujours rendu comme <li role="presentation"> non cliquable.
    expect(html).toMatch(
      /<li[^>]*role="presentation"[^>]*>Catégorisation produits<\/li>/,
    );
  });

  it("les 3 entrées de catégorisation suivent le sous-en-tête (nesting)", () => {
    currentPathname = "/tableau-de-bord";
    const html = render();
    const subgroupIdx = html.indexOf("Catégorisation produits");
    for (const href of [
      "/categorisation/categories",
      "/categorisation/animaux",
      "/categorisation/morceaux",
    ]) {
      expect(html.indexOf(`href="${href}"`)).toBeGreaterThan(subgroupIdx);
    }
  });

  it("active state préservé sur les référentiels (Données GMS + catégorisation)", () => {
    currentPathname = "/gms-prices";
    let html = render();
    expect(isActive(html, "/gms-prices")).toBe(true);

    currentPathname = "/categorisation/categories";
    html = render();
    expect(isActive(html, "/categorisation/categories")).toBe(true);
  });
});
