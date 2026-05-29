import { describe, expect, it } from "vitest";
import {
  computeCartSlotCompatibility,
  computeProductCartSlotPrevention,
  productSlotPairKey,
} from "@/lib/product-slot-availability/cart-compatibility";
import type {
  ProductAvailabilityPolicy,
  ProductSlotAvailabilityLink,
  SlotAvailabilityPolicy,
} from "@/lib/product-slot-availability/types";

const producerId = "producer-1";

function product(
  productId: string,
  mode: ProductAvailabilityPolicy["pickupAvailabilityMode"] =
    "all_shared_slots",
): ProductAvailabilityPolicy {
  return {
    productId,
    producerId,
    active: true,
    pickupAvailabilityMode: mode,
  };
}

function slot(
  slotId: string,
  scope: SlotAvailabilityPolicy["availabilityScope"] = "shared",
): SlotAvailabilityPolicy {
  return {
    slotId,
    producerId,
    active: true,
    excludedAt: null,
    availabilityScope: scope,
  };
}

function compute(
  products: ProductAvailabilityPolicy[],
  slots: SlotAvailabilityPolicy[],
  links: ProductSlotAvailabilityLink[] = [],
) {
  return computeCartSlotCompatibility({
    items: products.map((row) => ({
      productId: row.productId,
      producerId,
      slotId: "slot-1",
    })),
    products,
    slots,
    links,
  });
}

describe("cart product-slot compatibility", () => {
  it("intersection non vide: deux produits partout partagent les creneaux actifs", () => {
    const result = compute(
      [product("product-1"), product("product-2")],
      [slot("slot-1"), slot("slot-2")],
    );

    expect(result.hasSlotConflict).toBe(false);
    expect(result.compatibleSlots[producerId]).toEqual(["slot-1", "slot-2"]);
  });

  it("intersection vide: produits limites sur deux creneaux differents", () => {
    const result = compute(
      [
        product("product-1", "selected_slots"),
        product("product-2", "selected_slots"),
      ],
      [slot("slot-1"), slot("slot-2")],
      [
        { productId: "product-1", slotId: "slot-1" },
        { productId: "product-2", slotId: "slot-2" },
      ],
    );

    expect(result.hasSlotConflict).toBe(true);
    expect(result.compatibleSlots[producerId]).toEqual([]);
  });

  it("produit limite: le creneau choisi doit etre lie au produit", () => {
    const result = compute(
      [product("product-1", "selected_slots")],
      [slot("slot-1"), slot("slot-2")],
      [{ productId: "product-1", slotId: "slot-2" }],
    );

    expect(result.hasSlotConflict).toBe(true);
    expect(result.compatibleSlots[producerId]).toEqual(["slot-2"]);
    expect(
      result.itemCompatibility[productSlotPairKey("product-1", "slot-1")],
    ).toBe(false);
  });

  it("creneau reserve: refuse un produit non lie", () => {
    const result = compute(
      [product("product-1")],
      [slot("slot-1", "product_restricted")],
    );

    expect(result.hasSlotConflict).toBe(true);
    expect(result.compatibleSlots[producerId]).toEqual([]);
  });

  it("creneau reserve: accepte le produit lie", () => {
    const result = compute(
      [product("product-1")],
      [slot("slot-1", "product_restricted")],
      [{ productId: "product-1", slotId: "slot-1" }],
    );

    expect(result.hasSlotConflict).toBe(false);
    expect(result.compatibleSlots[producerId]).toEqual(["slot-1"]);
  });
});

describe("product page cart prevention", () => {
  it("panier vide: tous les creneaux compatibles du produit restent ajoutables", () => {
    const result = computeProductCartSlotPrevention({
      targetProductId: "product-1",
      targetProducerId: producerId,
      cartItems: [],
      products: [product("product-1")],
      slots: [slot("slot-1"), slot("slot-2")],
      links: [],
    });

    expect(result.hasSameProducerCartItems).toBe(false);
    expect(result.addableSlotIds).toEqual(["slot-1", "slot-2"]);
  });

  it("panier compatible: seul le creneau deja choisi dans le panier reste ajoutable", () => {
    const result = computeProductCartSlotPrevention({
      targetProductId: "product-2",
      targetProducerId: producerId,
      cartItems: [
        { productId: "product-1", producerId, slotId: "slot-1" },
      ],
      products: [product("product-1"), product("product-2")],
      slots: [slot("slot-1"), slot("slot-2")],
      links: [],
    });

    expect(result.hasSameProducerCartItems).toBe(true);
    expect(result.commonProductSlotIds).toEqual(["slot-1", "slot-2"]);
    expect(result.addableSlotIds).toEqual(["slot-1"]);
    expect(result.existingCartSlotIds).toEqual(["slot-1"]);
  });

  it("panier incompatible: aucun creneau ajoutable si le produit cible est limite ailleurs", () => {
    const result = computeProductCartSlotPrevention({
      targetProductId: "product-2",
      targetProducerId: producerId,
      cartItems: [
        { productId: "product-1", producerId, slotId: "slot-1" },
      ],
      products: [
        product("product-1"),
        product("product-2", "selected_slots"),
      ],
      slots: [slot("slot-1"), slot("slot-2")],
      links: [{ productId: "product-2", slotId: "slot-2" }],
    });

    expect(result.targetProductCompatibleSlotIds).toEqual(["slot-2"]);
    expect(result.commonProductSlotIds).toEqual(["slot-2"]);
    expect(result.addableSlotIds).toEqual([]);
  });

  it("creneau reserve: le produit non lie ne peut pas utiliser le creneau du panier", () => {
    const result = computeProductCartSlotPrevention({
      targetProductId: "product-2",
      targetProducerId: producerId,
      cartItems: [
        { productId: "product-1", producerId, slotId: "slot-1" },
      ],
      products: [product("product-1"), product("product-2")],
      slots: [slot("slot-1", "product_restricted")],
      links: [{ productId: "product-1", slotId: "slot-1" }],
    });

    expect(result.targetProductCompatibleSlotIds).toEqual([]);
    expect(result.addableSlotIds).toEqual([]);
  });
});
