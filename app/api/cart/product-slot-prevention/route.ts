import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { computeProductCartSlotPrevention } from "@/lib/product-slot-availability/cart-compatibility";
import type {
  ProductAvailabilityPolicy,
  ProductSlotAvailabilityLink,
  SlotAvailabilityPolicy,
} from "@/lib/product-slot-availability/types";

const HORIZON_DAYS = 90;

const bodySchema = z.object({
  productId: z.string().guid(),
  items: z
    .array(
      z.object({
        productId: z.string().guid(),
        producerId: z.string().guid(),
        creneauId: z.string().guid(),
      }),
    )
    .max(100),
});

type ProductRow = {
  id: string;
  producer_id: string | null;
  active: boolean | null;
  pickup_availability_mode: ProductAvailabilityPolicy["pickupAvailabilityMode"];
  delai_preparation_jours: number | null;
};

type SlotRow = {
  id: string;
  producer_id: string | null;
  active: boolean | null;
  excluded_at: string | null;
  availability_scope: SlotAvailabilityPolicy["availabilityScope"];
};

type ProductSlotLinkRow = {
  product_id: string;
  slot_id: string;
};

function uniqueValues(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

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

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { productId, items } = parsed.data;
  const admin = createSupabaseAdminClient();

  const { data: targetProductRow, error: targetProductError } = await admin
    .from("products")
    .select(
      "id, producer_id, active, pickup_availability_mode, delai_preparation_jours",
    )
    .eq("id", productId)
    .eq("active", true)
    .maybeSingle();

  if (targetProductError) {
    console.warn(
      `[PRODUCT_SLOT_PREVENTION_SELECT_FAIL] table=products error=${targetProductError.message}`,
    );
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }
  if (!targetProductRow?.producer_id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const targetProduct = targetProductRow as ProductRow;
  const targetProducerId = targetProduct.producer_id as string;
  const { data: producerRow, error: producerError } = await admin
    .from("producers")
    .select("id")
    .eq("id", targetProducerId)
    .eq("statut", "public")
    .is("deleted_at", null)
    .maybeSingle();

  if (producerError) {
    console.warn(
      `[PRODUCT_SLOT_PREVENTION_SELECT_FAIL] table=producers error=${producerError.message}`,
    );
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }
  if (!producerRow) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const sameProducerItems = items.filter(
    (item) => item.producerId === targetProducerId,
  );
  const productIds = uniqueValues([
    productId,
    ...sameProducerItems.map((item) => item.productId),
  ]);

  const now = new Date();
  const delai = targetProduct.delai_preparation_jours ?? 0;
  const earliest = new Date(now.getTime() + delai * 24 * 3600 * 1000);
  const horizonEnd = new Date(now.getTime() + HORIZON_DAYS * 24 * 3600 * 1000);

  const [productsRes, slotsRes, linksRes] = await Promise.all([
    admin
      .from("products")
      .select("id, producer_id, active, pickup_availability_mode")
      .in("id", productIds),
    admin
      .from("slots")
      .select("id, producer_id, active, excluded_at, availability_scope")
      .eq("producer_id", targetProducerId)
      .eq("active", true)
      .is("excluded_at", null)
      .gte("starts_at", earliest.toISOString())
      .lt("starts_at", horizonEnd.toISOString()),
    admin
      .from("product_slot_availabilities")
      .select("product_id, slot_id")
      .in("product_id", productIds),
  ]);

  if (productsRes.error || slotsRes.error || linksRes.error) {
    console.warn(
      `[PRODUCT_SLOT_PREVENTION_SELECT_FAIL] products=${productsRes.error?.message ?? "ok"} slots=${slotsRes.error?.message ?? "ok"} links=${linksRes.error?.message ?? "ok"}`,
    );
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }

  const result = computeProductCartSlotPrevention({
    targetProductId: productId,
    targetProducerId,
    cartItems: sameProducerItems.map((item) => ({
      productId: item.productId,
      producerId: item.producerId,
      slotId: item.creneauId,
    })),
    products: ((productsRes.data ?? []) as ProductRow[]).map(mapProduct),
    slots: ((slotsRes.data ?? []) as SlotRow[]).map(mapSlot),
    links: ((linksRes.data ?? []) as ProductSlotLinkRow[]).map(
      (link): ProductSlotAvailabilityLink => ({
        productId: link.product_id,
        slotId: link.slot_id,
      }),
    ),
  });

  return NextResponse.json(result);
}
