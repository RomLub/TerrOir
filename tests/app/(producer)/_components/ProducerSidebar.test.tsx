import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProducerNavBadges } from "@/lib/producers/nav-badges";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://www.terroir-local.fr";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "https://pro.terroir-local.fr";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.terroir-local.fr";
});

let currentPathname: string | null = "/dashboard";
vi.mock("next/navigation", () => ({
  usePathname: () => currentPathname,
}));

vi.mock("@/components/providers/user-provider", () => ({
  useUserContext: () => ({
    producer: {
      nom_exploitation: "Ferme des Tilleuls",
      statut: "public",
      slug: "ferme-des-tilleuls",
    },
    loading: false,
  }),
}));

vi.mock("@/components/ui", () => ({
  Logo: () => null,
  RoleSwitcher: () => null,
}));

import { ProducerSidebar } from "@/app/(producer)/_components/ProducerSidebar";

function render(badges?: ProducerNavBadges): string {
  const el = ProducerSidebar({ badges }) as ReactElement;
  return renderToStaticMarkup(el);
}

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
  return tag ? tag.includes('aria-current="page"') : false;
}

function sectionForHref(html: string, href: string): string {
  const start = html.indexOf(`href="${href}"`);
  if (start === -1) return "";
  const next = html.indexOf("href=", start + href.length);
  return html.slice(start, next === -1 ? undefined : next);
}

const ALL_HREFS = [
  "/dashboard",
  "/commandes",
  "/creneaux",
  "/mes-avis",
  "/catalogue",
  "/alertes-stock",
  "/ma-page",
  "/revenus",
  "/comptabilite",
  "/sante",
  "/parametres",
];

describe("ProducerSidebar structure", () => {
  it("rend les 4 groupes non cliquables", () => {
    currentPathname = "/dashboard";
    const html = render();
    for (const label of ["Ventes", "Ma boutique", "Finances", "Pilotage"]) {
      expect(html).toMatch(
        new RegExp(`<li[^>]*role="presentation"[^>]*>${label}</li>`),
      );
    }
  });

  it("rend les entrees attendues", () => {
    const html = render();
    for (const href of ALL_HREFS) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  it("Tableau de bord reste avant le groupe Ventes", () => {
    const html = render();
    expect(html.indexOf('href="/dashboard"')).toBeLessThan(
      html.indexOf(">Ventes</li>"),
    );
  });

  it("respecte l'ordre des groupes", () => {
    const html = render();
    const pos = (s: string) => html.indexOf(`>${s}</li>`);
    expect(pos("Ventes")).toBeGreaterThan(0);
    expect(pos("Ma boutique")).toBeGreaterThan(pos("Ventes"));
    expect(pos("Finances")).toBeGreaterThan(pos("Ma boutique"));
    expect(pos("Pilotage")).toBeGreaterThan(pos("Finances"));
  });

  it("range les items sous la bonne section", () => {
    const html = render();
    const ventes = html.indexOf(">Ventes</li>");
    const boutique = html.indexOf(">Ma boutique</li>");
    const finances = html.indexOf(">Finances</li>");
    const pilotage = html.indexOf(">Pilotage</li>");
    for (const href of ["/commandes", "/creneaux", "/mes-avis"]) {
      const i = html.indexOf(`href="${href}"`);
      expect(i).toBeGreaterThan(ventes);
      expect(i).toBeLessThan(boutique);
    }
    for (const href of ["/catalogue", "/alertes-stock", "/ma-page"]) {
      const i = html.indexOf(`href="${href}"`);
      expect(i).toBeGreaterThan(boutique);
      expect(i).toBeLessThan(finances);
    }
    for (const href of ["/revenus", "/comptabilite"]) {
      const i = html.indexOf(`href="${href}"`);
      expect(i).toBeGreaterThan(finances);
      expect(i).toBeLessThan(pilotage);
    }
    expect(html.indexOf('href="/sante"')).toBeGreaterThan(pilotage);
    expect(html.indexOf('href="/parametres"')).toBeGreaterThan(pilotage);
  });
});

describe("ProducerSidebar active state", () => {
  it("marque la route exacte et une sous-route", () => {
    currentPathname = "/commandes";
    let html = render();
    expect(isActive(html, "/commandes")).toBe(true);
    expect(isActive(html, "/catalogue")).toBe(false);

    currentPathname = "/commandes/abc";
    html = render();
    expect(isActive(html, "/commandes")).toBe(true);
  });
});

describe("ProducerSidebar badges", () => {
  it("affiche le badge commandes quand > 0", () => {
    currentPathname = "/dashboard";
    const html = render({ ordersToConfirm: 3, stockRuptures: 0, reviewsToAnswer: 0 });
    expect(sectionForHref(html, "/commandes")).toContain("3");
    expect(sectionForHref(html, "/commandes")).toContain("traiter");
  });

  it("n'affiche aucun badge quand tous les compteurs valent 0", () => {
    currentPathname = "/dashboard";
    const html = render({ ordersToConfirm: 0, stockRuptures: 0, reviewsToAnswer: 0 });
    expect(html).not.toContain("traiter");
  });

  it("affiche le badge ruptures quand > 0", () => {
    currentPathname = "/dashboard";
    const html = render({ ordersToConfirm: 0, stockRuptures: 5, reviewsToAnswer: 0 });
    expect(sectionForHref(html, "/alertes-stock")).toContain("5");
    expect(sectionForHref(html, "/alertes-stock")).toContain("traiter");
  });

  it("affiche le badge avis a repondre quand > 0", () => {
    currentPathname = "/dashboard";
    const html = render({ ordersToConfirm: 0, stockRuptures: 0, reviewsToAnswer: 3 });
    expect(sectionForHref(html, "/mes-avis")).toContain("3");
    expect(sectionForHref(html, "/mes-avis")).toContain("traiter");
  });

  it("n'affiche pas de badge avis quand reviewsToAnswer = 0", () => {
    currentPathname = "/dashboard";
    const html = render({ ordersToConfirm: 0, stockRuptures: 0, reviewsToAnswer: 0 });
    expect(sectionForHref(html, "/mes-avis")).not.toContain("traiter");
  });
});

describe("ProducerSidebar pied de page identite", () => {
  it("rend le nom d'exploitation et le lien fiche publique", () => {
    const html = render();
    expect(html).toContain("Ferme des Tilleuls");
    expect(html).toContain(
      'href="https://www.terroir-local.fr/producteurs/ferme-des-tilleuls"',
    );
    expect(html).toContain("Voir ma fiche publique");
  });
});
