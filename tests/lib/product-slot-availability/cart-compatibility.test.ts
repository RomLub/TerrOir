import { describe, expect, it } from "vitest";
import {
  computeCartSlotCompatibility,
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
