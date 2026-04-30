// Smoke tests pour le template stock-alert-confirm : subject + rendu HTML
// inclut les variables dynamiques. Pas de tests visuels (clients email
// très divergents, on s'appuie sur le pattern repo + EmailLayout).

import { describe, it, expect, vi } from "vitest";

// lib/resend/templates/layout.tsx import lib/env/urls.ts qui throw au
// module-load si NEXT_PUBLIC_APP_URL absent. Hoist le stub env-var avant
// les imports static (pattern aligné tests/app/api/admin/producers/invite/
// route.test.ts).
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3001";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002";
});

import { render } from "@react-email/render";
import StockAlertConfirm, {
  subject,
} from "@/lib/resend/templates/stock-alert-confirm";

const PROPS = {
  productName: "Côte de bœuf",
  productUrl: "https://terroir.test/producteurs/ferme-foo/produits/abc",
  confirmUrl: "https://terroir.test/api/stock-alerts/confirm?token=CONFIRM_T",
  unsubscribeUrl:
    "https://terroir.test/api/stock-alerts/unsubscribe?token=UNSUB_T",
};

describe("StockAlertConfirm — subject", () => {
  it("inclut le nom du produit", () => {
    expect(subject(PROPS)).toBe("Confirmez votre alerte stock — Côte de bœuf");
  });
});

describe("StockAlertConfirm — render HTML", () => {
  it("inclut le nom du produit", async () => {
    const html = await render(<StockAlertConfirm {...PROPS} />);
    expect(html).toContain("Côte de bœuf");
  });

  it("inclut l'URL produit (clic sur le nom)", async () => {
    const html = await render(<StockAlertConfirm {...PROPS} />);
    expect(html).toContain(PROPS.productUrl);
  });

  it("inclut l'URL de confirmation dans le bouton ET en lien direct visible", async () => {
    const html = await render(<StockAlertConfirm {...PROPS} />);
    // Le confirm_url apparaît au moins 2 fois (href bouton + texte
    // "Lien direct"). On teste juste qu'il est présent.
    expect(html).toContain(PROPS.confirmUrl);
    const occurrences = html.split(PROPS.confirmUrl).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it("inclut l'URL unsubscribe dans le pied de page", async () => {
    const html = await render(<StockAlertConfirm {...PROPS} />);
    expect(html).toContain(PROPS.unsubscribeUrl);
  });

  it("mentionne l'expiration 7 jours", async () => {
    const html = await render(<StockAlertConfirm {...PROPS} />);
    expect(html).toContain("7 jours");
  });
});
