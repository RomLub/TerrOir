import type { SupabaseClient } from "@supabase/supabase-js";
import {
  filterCompatibleSlotsForProduct,
  intersectSlotIds,
} from "./policy";
import type {
  ProductAvailabilityPolicy,
  ProductSlotAvailabilityLink,
  SlotAvailabilityPolicy,
} from "./types";

type CompatibleSlotsParams = {
  productId: string;
  from?: string;
  to?: string;
};

type CommonSlotsParams = {
  productIds: readonly string[];
  from?: string;
  to?: string;
};

type ProductRow = {
  id: string;
  producer_id: string | null;
  active: boolean | null;
  pickup_availability_mode: ProductAvailabilityPolicy["pickupAvailabilityMode"];
};

type SlotRow = {
  id: string;
  producer_id: string | null;
  active: boolean | null;
  excluded_at: string | null;
  availability_scope: SlotAvailabilityPolicy["availabilityScope"];
  starts_at: string;
};

type ProductSlotLinkRow = {
  product_id: string;
  slot_id: string;
};

function mapProduct(row: ProductRow): ProductAvailabilityPolicy {
  return {
    productId: row.id,
    producerId: row.producer_id,
    active: row.active,
    pickupAvailabilityMode: row.pickup_availability_mode,
  };
}

function mapSlot(row: SlotRow): SlotAvailabilityPolicy {
  return {
    slotId: row.id,
    producerId: row.producer_id,
    active: row.active,
    excludedAt: row.excluded_at,
    availabilityScope: row.availability_scope,
  };
}

function mapLink(row: ProductSlotLinkRow): ProductSlotAvailabilityLink {
  return {
    productId: row.product_id,
    slotId: row.slot_id,
  };
}

export async function isProductAvailableOnSlot(
  supabase: SupabaseClient,
  productId: string,
  slotId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_product_available_on_slot", {
    p_product_id: productId,
    p_slot_id: slotId,
  });
  if (error) throw error;
  return data === true;
}

export async function listCompatibleSlotsForProduct(
  supabase: SupabaseClient,
  params: CompatibleSlotsParams,
): Promise<SlotAvailabilityPolicy[]> {
  const { data: productRow, error: productError } = await supabase
    .from("products")
    .select("id, producer_id, active, pickup_availability_mode")
    .eq("id", params.productId)
    .single();
  if (productError) throw productError;

  const product = mapProduct(productRow as ProductRow);
  if (product.producerId === null) return [];

  let slotsQuery = supabase
    .from("slots")
    .select("id, producer_id, active, excluded_at, availability_scope, starts_at")
    .eq("producer_id", product.producerId)
    .order("starts_at", { ascending: true });

  if (params.from) {
    slotsQuery = slotsQuery.gte("starts_at", params.from);
  }
  if (params.to) {
    slotsQuery = slotsQuery.lt("starts_at", params.to);
  }

  const { data: slotRows, error: slotsError } = await slotsQuery;
  if (slotsError) throw slotsError;

  const { data: linkRows, error: linksError } = await supabase
    .from("product_slot_availabilities")
    .select("product_id, slot_id")
    .eq("product_id", params.productId);
  if (linksError) throw linksError;

  return filterCompatibleSlotsForProduct(
    product,
    ((slotRows ?? []) as SlotRow[]).map(mapSlot),
    ((linkRows ?? []) as ProductSlotLinkRow[]).map(mapLink),
  );
}

export async function listCommonCompatibleSlotsForProducts(
  supabase: SupabaseClient,
  params: CommonSlotsParams,
): Promise<SlotAvailabilityPolicy[]> {
  if (params.productIds.length === 0) return [];

  const perProductSlots = await Promise.all(
    params.productIds.map((productId) =>
      listCompatibleSlotsForProduct(supabase, {
        productId,
        from: params.from,
        to: params.to,
      }),
    ),
  );

  const commonIds = new Set(
    intersectSlotIds(
      perProductSlots.map((slots) => slots.map((slot) => slot.slotId)),
    ),
  );

  return perProductSlots[0]?.filter((slot) => commonIds.has(slot.slotId)) ?? [];
}
