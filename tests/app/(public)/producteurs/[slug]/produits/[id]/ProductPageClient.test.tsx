// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProductPageClient,
  type ProducerSummary,
  type ProductDetail,
  type SlotOption,
} from "@/app/(public)/producteurs/[slug]/produits/[id]/ProductPageClient";
import { useCartStore } from "@/lib/store/cart";

vi.mock("next/image", () => ({
  default: ({
    alt,
    src,
  }: {
    alt?: string;
    src?: string | { src?: string };
  }) =>
    createElement("img", {
      alt: alt ?? "",
      src: typeof src === "string" ? src : src?.src ?? "",
    }),
}));

vi.mock("@/components/ui", () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  ProductCard: ({ product }: { product: { name: string } }) => (
    <article>{product.name}</article>
  ),
}));

vi.mock("@/components/providers/user-provider", () => ({
  useUserContext: () => ({ producer: null }),
}));

vi.mock(
  "@/app/(public)/producteurs/[slug]/produits/[id]/_components/MiniMapLazy",
  () => ({
    MiniMapLazy: () => <div data-testid="mini-map" />,
  }),
);

const producer: ProducerSummary = {
  id: "producer-1",
  slug: "clos-cenomane",
  name: "GAEC du Clos Cenomane",
  firstName: "Chloe",
  commune: "Écommoy · 72220",
  address: "La Fournière · 72220 · Écommoy",
  lat: 47.9,
  lng: 0.2,
};

const product: ProductDetail = {
  id: "product-1",
  name: "Brioche au beurre — 400 g",
  price: 7,
  unit: "piece",
  weightStep: 1,
  stockLeft: 20,
  stockUnlimited: false,
  delaiJours: 1,
  photos: [],
  description: ["Recette familiale, beurre fermier."],
  conseil: { active: false, texte: null },
};

const slots: SlotOption[] = [
  {
    id: "slot-1",
    starts_at: "2026-06-03T13:00:00.000Z",
    ends_at: "2026-06-03T13:45:00.000Z",
    capacity_per_slot: 5,
    left: 5,
    availableForProduct: true,
  },
  {
    id: "slot-2",
    starts_at: "2026-06-06T13:00:00.000Z",
    ends_at: "2026-06-06T13:45:00.000Z",
    capacity_per_slot: 5,
    left: 5,
    availableForProduct: true,
  },
];

function renderProductPage() {
  return render(
    <ProductPageClient
      producer={producer}
      product={product}
      slots={slots}
      otherProducts={[]}
    />,
  );
}

beforeEach(() => {
  useCartStore.setState({ items: [] });
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ProductPageClient — conversion fiche produit", () => {
  it("explique le parcours commande près de la zone d'achat", () => {
    renderProductPage();

    expect(screen.getByText("Comment commander")).not.toBeNull();
    expect(screen.getByText("Choisis ton créneau de retrait.")).not.toBeNull();
    expect(screen.getByText("Ajoute le produit au panier.")).not.toBeNull();
    expect(
      screen.getByText("Paie en ligne au moment de finaliser."),
    ).not.toBeNull();
    expect(
      screen.getByText("La commande est transmise au producteur."),
    ).not.toBeNull();
  });

  it("place le panneau d'achat avant la longue liste des créneaux", () => {
    renderProductPage();

    const pageText = document.body.textContent ?? "";
    expect(pageText.indexOf("Total estimé")).toBeGreaterThan(-1);
    expect(pageText.indexOf("Créneau de retrait à la ferme")).toBeGreaterThan(-1);
    expect(pageText.indexOf("Total estimé")).toBeLessThan(
      pageText.indexOf("Créneau de retrait à la ferme"),
    );
  });

  it("affiche le résumé du retrait sélectionné juste avant le CTA", () => {
    renderProductPage();

    fireEvent.click(screen.getByRole("button", { name: "Créneau 15h–15h45" }));

    expect(screen.getByText("Retrait sélectionné")).not.toBeNull();
    expect(screen.getAllByText("Mercredi 3 juin").length).toBeGreaterThan(0);
    expect(screen.getAllByText("15h–15h45").length).toBeGreaterThan(0);
    expect(screen.getAllByText("GAEC du Clos Cenomane").length).toBeGreaterThan(0);
    expect(document.body.textContent).toContain("Écommoy · 72220");
    expect(
      (screen.getByRole("button", { name: "Ajouter au panier" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
});
