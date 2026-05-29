export const PRODUCT_PICKUP_AVAILABILITY_MODES = [
  "all_shared_slots",
  "selected_slots",
] as const;

export type ProductPickupAvailabilityMode =
  (typeof PRODUCT_PICKUP_AVAILABILITY_MODES)[number];

export const SLOT_AVAILABILITY_SCOPES = [
  "shared",
  "product_restricted",
] as const;

export type SlotAvailabilityScope = (typeof SLOT_AVAILABILITY_SCOPES)[number];

export type ProductAvailabilityPolicy = {
  productId: string;
  producerId: string | null;
  active: boolean | null;
  pickupAvailabilityMode: ProductPickupAvailabilityMode | null;
};

export type SlotAvailabilityPolicy = {
  slotId: string;
  producerId: string | null;
  active: boolean | null;
  excludedAt: string | null;
  availabilityScope: SlotAvailabilityScope | null;
};

export type ProductSlotAvailabilityLink = {
  productId: string;
  slotId: string;
};
