// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  cartGroupId,
  groupCartItems,
  removeCartGroupItems,
} from "@/lib/cart/groups";
import { useCartStore, type CartItem } from "@/lib/store/cart";

function item(overrides: Partial<CartItem> = {}): CartItem {
  return {
    productId: overrides.productId ?? "11111111-1111-4111-8111-111111111111",
    producerId: overrides.producerId ?? "22222222-2222-4222-8222-222222222222",
    slug: overrides.slug ?? "ferme-a",
    nom: overrides.nom ?? "Produit test",
    prix: overrides.prix ?? 10,
    unite: overrides.unite ?? "piece",
    quantite: overrides.quantite ?? 1,
    creneauId: overrides.creneauId ?? "33333333-3333-4333-8333-333333333333",
    dateRetrait: overrides.dateRetrait ?? "2026-06-01",
    producerName: overrides.producerName ?? "Ferme A",
    image: overrides.image ?? null,
  };
}

describe("cart groups", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useCartStore.setState({ items: [] });
  });

  it("regroupe par producteur, creneau et date de retrait", () => {
    const first = item({ productId: "11111111-1111-4111-8111-111111111111" });
    const sameOrder = item({
      productId: "11111111-1111-4111-8111-111111111112",
    });
    const otherProducer = item({
      productId: "11111111-1111-4111-8111-111111111113",
      producerId: "22222222-2222-4222-8222-222222222223",
      producerName: "Ferme B",
      slug: "ferme-b",
    });
    const otherSlot = item({
      productId: "11111111-1111-4111-8111-111111111114",
      creneauId: "33333333-3333-4333-8333-333333333334",
    });

    const groups = groupCartItems([first, sameOrder, otherProducer, otherSlot]);

    expect(groups).toHaveLength(3);
    expect(groups[0]?.items.map((groupItem) => groupItem.productId)).toEqual([
      first.productId,
      sameOrder.productId,
    ]);
    expect(groups[1]?.producerName).toBe("Ferme B");
    expect(groups[2]?.slotId).toBe(otherSlot.creneauId);
  });

  it("retire uniquement le groupe paye et conserve les autres groupes", () => {
    const paid = item({ productId: "11111111-1111-4111-8111-111111111111" });
    const paidSecondLine = item({
      productId: "11111111-1111-4111-8111-111111111112",
    });
    const kept = item({
      productId: "11111111-1111-4111-8111-111111111113",
      producerId: "22222222-2222-4222-8222-222222222223",
      producerName: "Ferme B",
      slug: "ferme-b",
    });

    const remaining = removeCartGroupItems(
      [paid, paidSecondLine, kept],
      cartGroupId(paid),
    );

    expect(remaining).toEqual([kept]);
  });

  it("le store panier supprime un groupe sans vider le panier", () => {
    const paid = item({ productId: "11111111-1111-4111-8111-111111111111" });
    const kept = item({
      productId: "11111111-1111-4111-8111-111111111112",
      creneauId: "33333333-3333-4333-8333-333333333334",
    });

    useCartStore.setState({ items: [paid, kept] });
    useCartStore.getState().removeGroup(cartGroupId(paid));

    expect(useCartStore.getState().items).toEqual([kept]);
  });
});
