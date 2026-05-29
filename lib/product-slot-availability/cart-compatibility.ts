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

export type ProductCartSlotPreventionItem = {
  productId: string;
  producerId: string;
  slotId: string;
};

export type ProductCartSlotPrevention = {
  hasSameProducerCartItems: boolean;
  targetProductCompatibleSlotIds: string[];
  commonProductSlotIds: string[];
  addableSlotIds: string[];
  existingCartSlotIds: string[];
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

export function computeProductCartSlotPrevention(params: {
  targetProductId: string;
  targetProducerId: string;
  cartItems: readonly ProductCartSlotPreventionItem[];
  products: readonly ProductAvailabilityPolicy[];
  slots: readonly SlotAvailabilityPolicy[];
  links: readonly ProductSlotAvailabilityLink[];
}): ProductCartSlotPrevention {
  const productsById = new Map(
    params.products.map((product) => [product.productId, product]),
  );
  const targetProduct = productsById.get(params.targetProductId);
  if (!targetProduct) {
    return {
      hasSameProducerCartItems: false,
      targetProductCompatibleSlotIds: [],
      commonProductSlotIds: [],
      addableSlotIds: [],
      existingCartSlotIds: [],
    };
  }

  const producerSlots = params.slots.filter(
    (slot) => slot.producerId === params.targetProducerId,
  );
  const targetProductCompatibleSlotIds = filterCompatibleSlotsForProduct(
    targetProduct,
    producerSlots,
    params.links,
  ).map((slot) => slot.slotId);

  const sameProducerItems = params.cartItems.filter(
    (item) => item.producerId === params.targetProducerId,
  );
  const hasSameProducerCartItems = sameProducerItems.length > 0;
  if (!hasSameProducerCartItems) {
    return {
      hasSameProducerCartItems,
      targetProductCompatibleSlotIds,
      commonProductSlotIds: targetProductCompatibleSlotIds,
      addableSlotIds: targetProductCompatibleSlotIds,
      existingCartSlotIds: [],
    };
  }

  const productIds = uniqueValues([
    params.targetProductId,
    ...sameProducerItems.map((item) => item.productId),
  ]);
  const perProductSlotIds = productIds.map((productId) => {
    const product = productsById.get(productId);
    if (!product) return [];
    return filterCompatibleSlotsForProduct(
      product,
      producerSlots,
      params.links,
    ).map((slot) => slot.slotId);
  });
  const commonProductSlotIds = intersectSlotIds(perProductSlotIds);
  const existingCartSlotIds = uniqueValues(
    sameProducerItems.map((item) => item.slotId),
  );

  const addableSlotIds =
    existingCartSlotIds.length === 1
      ? commonProductSlotIds.filter((slotId) =>
          existingCartSlotIds.includes(slotId),
        )
      : [];

  return {
    hasSameProducerCartItems,
    targetProductCompatibleSlotIds,
    commonProductSlotIds,
    addableSlotIds,
    existingCartSlotIds,
  };
}
