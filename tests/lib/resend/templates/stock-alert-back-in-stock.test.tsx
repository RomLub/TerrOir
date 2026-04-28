// Smoke tests pour le template stock-alert-back-in-stock.

import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3001";
});

vi.mock("server-only", () => ({}));

import { render } from "@react-email/render";
import StockAlertBackInStock, {
  subject,
} from "@/lib/resend/templates/stock-alert-back-in-stock";

const BASE_PROPS = {
  productName: "Faux-filet",
  productUrl: "https://terroir.test/producteurs/ferme-foo/produits/abc",
  unsubscribeUrl:
    "https://terroir.test/api/stock-alerts/unsubscribe?token=UNSUB_T",
};

describe("StockAlertBackInStock — subject", () => {
  it("annonce le retour en stock du produit", () => {
    expect(subject({ ...BASE_PROPS, producerName: null })).toBe(
      "Faux-filet est de retour en stock",
    );
  });
});

describe("StockAlertBackInStock — render HTML", () => {
  it("inclut le nom du produit + URL produit (cliquable)", async () => {
    const html = await render(
      <StockAlertBackInStock {...BASE_PROPS} producerName={null} />,
    );
    expect(html).toContain("Faux-filet");
    expect(html).toContain(BASE_PROPS.productUrl);
  });

  it("affiche le nom du producer si fourni", async () => {
    const html = await render(
      <StockAlertBackInStock
        {...BASE_PROPS}
        producerName="Ferme du Foo"
      />,
    );
    expect(html).toContain("Ferme du Foo");
    expect(html).toContain("produit par");
  });

  it("omet la mention producer si producerName=null", async () => {
    const html = await render(
      <StockAlertBackInStock {...BASE_PROPS} producerName={null} />,
    );
    expect(html).not.toContain("produit par");
  });

  it("inclut le bouton CTA pointant vers product_url", async () => {
    const html = await render(
      <StockAlertBackInStock {...BASE_PROPS} producerName={null} />,
    );
    // Le bouton CTA "Voir le produit" (texte) + l'URL en href.
    expect(html).toContain("Voir le produit");
    // Le lien produit apparaît au moins 2 fois (clic sur nom + bouton CTA).
    const occurrences = html.split(BASE_PROPS.productUrl).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it("inclut le lien unsubscribe dans le footer", async () => {
    const html = await render(
      <StockAlertBackInStock {...BASE_PROPS} producerName={null} />,
    );
    expect(html).toContain(BASE_PROPS.unsubscribeUrl);
  });
});
