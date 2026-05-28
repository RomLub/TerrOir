import { describe, expect, it } from "vitest";
import {
  filterCompatibleSlotsForProduct,
  intersectSlotIds,
  isProductSlotCompatibleByPolicy,
} from "@/lib/product-slot-availability/policy";
import type {
  ProductAvailabilityPolicy,
  ProductSlotAvailabilityLink,
  SlotAvailabilityPolicy,
} from "@/lib/product-slot-availability/types";

const baseProduct: ProductAvailabilityPolicy = {
  productId: "product-1",
  producerId: "producer-1",
  active: true,
  pickupAvailabilityMode: "all_shared_slots",
};

const sharedSlot: SlotAvailabilityPolicy = {
  slotId: "slot-shared",
  producerId: "producer-1",
  active: true,
  excludedAt: null,
  availabilityScope: "shared",
};

const restrictedSlot: SlotAvailabilityPolicy = {
  ...sharedSlot,
  slotId: "slot-restricted",
  availabilityScope: "product_restricted",
};

const link: ProductSlotAvailabilityLink = {
  productId: "product-1",
  slotId: "slot-restricted",
};

describe("product-slot availability policy", () => {
  it("produit partout: compatible avec un creneau partage sans configuration", () => {
    expect(isProductSlotCompatibleByPolicy(baseProduct, sharedSlot, [])).toBe(
      true,
    );
  });

  it("produit limite: compatible uniquement avec les creneaux lies", () => {
    const selectedProduct: ProductAvailabilityPolicy = {
      ...baseProduct,
      pickupAvailabilityMode: "selected_slots",
    };

    expect(
      isProductSlotCompatibleByPolicy(selectedProduct, sharedSlot, []),
    ).toBe(false);
    expect(
      isProductSlotCompatibleByPolicy(selectedProduct, sharedSlot, [
        { productId: "product-1", slotId: "slot-shared" },
      ]),
    ).toBe(true);
  });

  it("creneau reserve: refuse les produits non lies", () => {
    expect(
      isProductSlotCompatibleByPolicy(baseProduct, restrictedSlot, []),
    ).toBe(false);
    expect(
      isProductSlotCompatibleByPolicy(baseProduct, restrictedSlot, [link]),
    ).toBe(true);
  });

  it("produit existant avant migration: null equivaut a all_shared_slots", () => {
    expect(
      isProductSlotCompatibleByPolicy(
        { ...baseProduct, pickupAvailabilityMode: null },
        { ...sharedSlot, availabilityScope: null },
        [],
      ),
    ).toBe(true);
  });

  it("compatibilite: refuse producteur different, produit inactif, creneau ferme", () => {
    expect(
      isProductSlotCompatibleByPolicy(
        { ...baseProduct, producerId: "producer-2" },
        sharedSlot,
        [],
      ),
    ).toBe(false);
    expect(
      isProductSlotCompatibleByPolicy(
        { ...baseProduct, active: false },
        sharedSlot,
        [],
      ),
    ).toBe(false);
    expect(
      isProductSlotCompatibleByPolicy(
        baseProduct,
        { ...sharedSlot, excludedAt: "2026-06-01T08:00:00.000Z" },
        [],
      ),
    ).toBe(false);
  });

  it("recuperation des creneaux compatibles d'un produit", () => {
    const compatible = filterCompatibleSlotsForProduct(
      {
        ...baseProduct,
        pickupAvailabilityMode: "selected_slots",
      },
      [sharedSlot, restrictedSlot],
      [{ productId: "product-1", slotId: "slot-restricted" }],
    );

    expect(compatible.map((slot) => slot.slotId)).toEqual(["slot-restricted"]);
  });

  it("intersection future de creneaux: conserve l'ordre de la premiere liste", () => {
    expect(
      intersectSlotIds([
        ["slot-3", "slot-1", "slot-2", "slot-1"],
        ["slot-1", "slot-2", "slot-3"],
        ["slot-2", "slot-3"],
      ]),
    ).toEqual(["slot-3", "slot-2"]);
  });
});
