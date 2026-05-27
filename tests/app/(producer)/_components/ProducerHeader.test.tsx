import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// ProducerHeader : barre du haut espace producteur, porte le lien
// "Voir ma fiche publique" cross-subdomain conditionné sur le statut.
// Pas de jsdom : rendu serveur read-only. Logo/RoleToggle stubés ;
// useUserContext et useLogoutFlow mockés.

// lib/env/urls.ts fail-fast au load si NEXT_PUBLIC_APP_URL n'est pas défini.
// Le lien fiche publique consomme buildPublicProducerUrl qui dépend de cette
// env var — pattern hoisted obligatoire (cf. role-switcher-urls).
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://www.terroir-local.fr";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "https://pro.terroir-local.fr";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.terroir-local.fr";
});

type MockProducer = {
  id: string;
  slug: string;
  nom_exploitation: string;
  statut: string;
} | null;

let mockProducer: MockProducer = null;

vi.mock("@/components/providers/user-provider", () => ({
  useUserContext: () => ({
    user: { email: "producer@example.com" },
    producer: mockProducer,
    loading: false,
  }),
}));

vi.mock("@/lib/auth/use-logout-flow", () => ({
  useLogoutFlow: () => ({ logout: vi.fn(), isLoggingOut: false }),
}));

vi.mock("@/components/ui", () => ({
  Logo: () => null,
  RoleToggle: () => null,
}));

import { ProducerHeader } from "@/app/(producer)/_components/ProducerHeader";

function render(): string {
  const el = ProducerHeader() as ReactElement;
  return renderToStaticMarkup(el);
}

describe("ProducerHeader — lien fiche publique", () => {
  beforeEach(() => {
    mockProducer = null;
  });

  it("affiche le lien vers la fiche publique quand statut=public + slug", () => {
    mockProducer = {
      id: "p-1",
      slug: "ferme-des-tilleuls",
      nom_exploitation: "Ferme des Tilleuls",
      statut: "public",
    };
    const html = render();
    expect(html).toContain(
      'href="https://www.terroir-local.fr/producteurs/ferme-des-tilleuls"',
    );
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("Voir ma fiche publique");
  });

  it("masque le lien quand le producteur n'a pas encore publié sa fiche (statut=active)", () => {
    mockProducer = {
      id: "p-2",
      slug: "ferme-en-attente",
      nom_exploitation: "Ferme en attente",
      statut: "active",
    };
    const html = render();
    expect(html).not.toContain("Voir ma fiche publique");
    expect(html).not.toContain("/producteurs/ferme-en-attente");
  });

  it("masque le lien quand producer est null (cas invitation non aboutie)", () => {
    mockProducer = null;
    const html = render();
    expect(html).not.toContain("Voir ma fiche publique");
    expect(html).not.toContain("/producteurs/");
  });
});
