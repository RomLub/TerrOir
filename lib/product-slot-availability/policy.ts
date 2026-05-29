import type {
  ProductAvailabilityPolicy,
  ProductSlotAvailabilityLink,
  SlotAvailabilityPolicy,
} from "./types";

function linkKey(productId: string, slotId: string): string {
  return `${productId}:${slotId}`;
}

function isLinkArray(
  links: ReadonlySet<string> | readonly ProductSlotAvailabilityLink[],
): links is readonly ProductSlotAvailabilityLink[] {
  return Array.isArray(links);
}

export function buildProductSlotLinkSet(
  links: readonly ProductSlotAvailabilityLink[],
): Set<string> {
  return new Set(links.map((link) => linkKey(link.productId, link.slotId)));
}

export function isProductSlotCompatibleByPolicy(
  product: ProductAvailabilityPolicy,
  slot: SlotAvailabilityPolicy,
  links: ReadonlySet<string> | readonly ProductSlotAvailabilityLink[],
): boolean {
  if (!product.active || !slot.active || slot.excludedAt !== null) {
    return false;
  }

  if (
    product.producerId === null ||
    slot.producerId === null ||
    product.producerId !== slot.producerId
  ) {
    return false;
  }

  const linkSet = isLinkArray(links) ? buildProductSlotLinkSet(links) : links;
  const hasExplicitLink = linkSet.has(linkKey(product.productId, slot.slotId));
  const productMode = product.pickupAvailabilityMode ?? "all_shared_slots";
  const slotScope = slot.availabilityScope ?? "shared";

  if (slotScope === "product_restricted") {
    return hasExplicitLink;
  }

  if (productMode === "selected_slots") {
    return hasExplicitLink;
  }

  return true;
}

export function filterCompatibleSlotsForProduct(
  product: ProductAvailabilityPolicy,
  slots: readonly SlotAvailabilityPolicy[],
  links: readonly ProductSlotAvailabilityLink[],
): SlotAvailabilityPolicy[] {
  const linkSet = buildProductSlotLinkSet(links);
  return slots.filter((slot) =>
    isProductSlotCompatibleByPolicy(product, slot, linkSet),
  );
}

export function intersectSlotIds(
  slotIdLists: readonly (readonly string[])[],
): string[] {
  if (slotIdLists.length === 0) return [];

  const [first, ...rest] = slotIdLists;
  if (first === undefined) return [];

  const restSets = rest.map((ids) => new Set(ids));
  const seen = new Set<string>();
  const result: string[] = [];

  for (const slotId of first) {
    if (seen.has(slotId)) continue;
    seen.add(slotId);
    if (restSets.every((set) => set.has(slotId))) {
      result.push(slotId);
    }
  }

  return result;
}
