import {
  buildProductSlotLinkSet,
  filterCompatibleSlotsForProduct,
  intersectSlotIds,
  isProductSlotCompatibleByPolicy,
} from "./policy";
import type {
  ProductAvailabilityPolicy,
  ProductSlotAvailabilityLink,
  SlotAvailabilityPolicy,
} from "./types";

export type CartSlotCompatibilityItem = {
  productId: string;
  producerId: string;
  slotId: string;
};

export type CartSlotCompatibility = {
  hasSlotConflict: boolean;
  compatibleSlots: Record<string, string[]>;
  itemCompatibility: Record<string, boolean>;
};

export function productSlotPairKey(productId: string, slotId: string): string {
  return `${productId}|${slotId}`;
}

function uniqueValues(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

export function computeCartSlotCompatibility(params: {
  items: readonly CartSlotCompatibilityItem[];
  products: readonly ProductAvailabilityPolicy[];
  slots: readonly SlotAvailabilityPolicy[];
  links: readonly ProductSlotAvailabilityLink[];
}): CartSlotCompatibility {
  const productsById = new Map(
    params.products.map((product) => [product.productId, product]),
  );
  const slotsById = new Map(params.slots.map((slot) => [slot.slotId, slot]));
  const linkSet = buildProductSlotLinkSet(params.links);
  const producerIds = uniqueValues(params.items.map((item) => item.producerId));

  const compatibleSlots: Record<string, string[]> = {};

  for (const producerId of producerIds) {
    const producerItems = params.items.filter(
      (item) => item.producerId === producerId,
    );
    const producerProductIds = uniqueValues(
      producerItems.map((item) => item.productId),
    );
    const producerSlots = params.slots.filter(
      (slot) => slot.producerId === producerId,
    );

    const perProductSlotIds = producerProductIds.map((productId) => {
      const product = productsById.get(productId);
      if (!product) return [];
      return filterCompatibleSlotsForProduct(
        product,
        producerSlots,
        params.links,
      ).map((slot) => slot.slotId);
    });

    compatibleSlots[producerId] = intersectSlotIds(perProductSlotIds);
  }

  const itemCompatibility: Record<string, boolean> = {};
  for (const item of params.items) {
    const product = productsById.get(item.productId);
    const slot = slotsById.get(item.slotId);
    itemCompatibility[productSlotPairKey(item.productId, item.slotId)] =
      product && slot
        ? isProductSlotCompatibleByPolicy(product, slot, linkSet)
        : false;
  }

  const hasSlotConflict = params.items.some((item) => {
    const groupCompatibleSlots = compatibleSlots[item.producerId] ?? [];
    return (
      groupCompatibleSlots.length === 0 ||
      !groupCompatibleSlots.includes(item.slotId) ||
      itemCompatibility[productSlotPairKey(item.productId, item.slotId)] ===
        false
    );
  });

  return {
    hasSlotConflict,
    compatibleSlots,
    itemCompatibility,
  };
}
