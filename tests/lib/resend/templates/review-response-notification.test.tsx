// Smoke tests pour le template review-response-notification (CGU 6.4).

import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3001";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002";
});

import { render } from "@react-email/render";
import ReviewResponseNotification, {
  subject,
} from "@/lib/resend/templates/review-response-notification";

const BASE_PROPS = {
  consumerFirstName: "Marie",
  producerName: "Ferme du Foo",
  originalReview: "Excellente viande, très tendre.",
  responseText: "Merci beaucoup pour votre retour, à bientôt !",
  producerUrl: "https://terroir.test/producteurs/ferme-foo",
  preferencesUrl: "https://terroir.test/compte/notifications",
};

describe("ReviewResponseNotification — subject", () => {
  it("nomme le producteur dans l'objet", () => {
    expect(subject(BASE_PROPS)).toBe(
      "[TerrOir] Ferme du Foo a répondu à ton avis",
    );
  });
});

describe("ReviewResponseNotification — render HTML", () => {
  it("inclut le prénom consumer dans la salutation", async () => {
    const html = await render(<ReviewResponseNotification {...BASE_PROPS} />);
    expect(html).toContain("Bonjour Marie");
  });

  it("salutation neutre si pas de prénom", async () => {
    const html = await render(
      <ReviewResponseNotification {...BASE_PROPS} consumerFirstName="" />,
    );
    expect(html).toContain("Bonjour,");
    expect(html).not.toContain("Bonjour Marie");
  });

  it("inclut le nom du producer + extrait de l'avis original + texte réponse", async () => {
    const html = await render(<ReviewResponseNotification {...BASE_PROPS} />);
    expect(html).toContain("Ferme du Foo");
    expect(html).toContain("Excellente viande");
    expect(html).toContain("Merci beaucoup pour votre retour");
  });

  it("tronque l'avis original au-delà de 200 chars", async () => {
    const longReview = "A".repeat(250);
    const html = await render(
      <ReviewResponseNotification {...BASE_PROPS} originalReview={longReview} />,
    );
    expect(html).toContain("…");
    expect(html).not.toContain("A".repeat(250));
  });

  it("inclut CTA producer + lien désabo prefs", async () => {
    const html = await render(<ReviewResponseNotification {...BASE_PROPS} />);
    expect(html).toContain(BASE_PROPS.producerUrl);
    expect(html).toContain(BASE_PROPS.preferencesUrl);
    expect(html).toContain("Voir sur TerrOir");
    expect(html).toContain("Désactiver");
  });
});
