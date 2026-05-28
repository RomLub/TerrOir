import { describe, it, expect, beforeAll, afterEach } from "vitest";
import {
  getSqlIntegrationClient,
  isLocalSupabaseReachable,
} from "./helpers/client";
import {
  cleanupProducer,
  seedProducer,
  type SeededProducer,
} from "./helpers/seed";

const SUPABASE = getSqlIntegrationClient();
const reachable = await isLocalSupabaseReachable();
const describeIfLocal = reachable ? describe : describe.skip;

type DbError = {
  code?: string;
  hint?: string | null;
};

async function seedSlot(
  producerId: string,
  overrides?: Partial<{
    availability_scope: "shared" | "product_restricted";
    active: boolean;
    excluded_at: string | null;
  }>,
): Promise<string> {
  const { data, error } = await SUPABASE
    .from("slots")
    .insert({
      producer_id: producerId,
      rule_id: null,
      starts_at: "2026-06-02T09:00:00+02:00",
      ends_at: "2026-06-02T10:00:00+02:00",
      capacity_per_slot: 2,
      active: overrides?.active ?? true,
      excluded_at: overrides?.excluded_at ?? null,
      availability_scope: overrides?.availability_scope ?? "shared",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seedSlot: ${error?.message}`);
  return data.id;
}

async function seedProduct(
  producerId: string,
  overrides?: Partial<{
    pickup_availability_mode: "all_shared_slots" | "selected_slots";
    active: boolean;
  }>,
): Promise<string> {
  const { data, error } = await SUPABASE
    .from("products")
    .insert({
      producer_id: producerId,
      nom: `Produit disponibilite ${crypto.randomUUID().slice(0, 8)}`,
      prix: 10,
      unite: "kg",
      stock_disponible: 10,
      stock_illimite: false,
      active: overrides?.active ?? true,
      pickup_availability_mode:
        overrides?.pickup_availability_mode ?? "all_shared_slots",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seedProduct: ${error?.message}`);
  return data.id;
}

async function isAvailable(productId: string, slotId: string): Promise<boolean> {
  const { data, error } = await SUPABASE.rpc("is_product_available_on_slot", {
    p_product_id: productId,
    p_slot_id: slotId,
  });
  if (error) throw new Error(error.message);
  return data === true;
}

describeIfLocal("product slot availability SQL", () => {
  let seeded: SeededProducer[] = [];

  beforeAll(() => {
    if (!reachable) {
      console.warn(
        "[product-slot-availability] Supabase locale non joignable, tests SQL skippes.",
      );
    }
  });

  afterEach(async () => {
    for (const producer of seeded) {
      await cleanupProducer(SUPABASE, producer);
    }
    seeded = [];
  });

  async function createProducer(): Promise<SeededProducer> {
    const producer = await seedProducer(SUPABASE, { statut: "public" });
    seeded.push(producer);
    return producer;
  }

  it("produit partout: produit existant/sans configuration explicite reste compatible avec un creneau partage", async () => {
    const producer = await createProducer();

    const { data: product, error: productErr } = await SUPABASE
      .from("products")
      .insert({
        producer_id: producer.producerId,
        nom: "Produit legacy",
        prix: 10,
        unite: "kg",
        stock_disponible: 10,
        stock_illimite: false,
        active: true,
      })
      .select("id, pickup_availability_mode")
      .single();
    if (productErr || !product) throw new Error(productErr?.message);

    const { data: slot, error: slotErr } = await SUPABASE
      .from("slots")
      .insert({
        producer_id: producer.producerId,
        rule_id: null,
        starts_at: "2026-06-02T09:00:00+02:00",
        ends_at: "2026-06-02T10:00:00+02:00",
        capacity_per_slot: 2,
        active: true,
      })
      .select("id, availability_scope")
      .single();
    if (slotErr || !slot) throw new Error(slotErr?.message);

    expect(product.pickup_availability_mode).toBe("all_shared_slots");
    expect(slot.availability_scope).toBe("shared");
    expect(await isAvailable(product.id as string, slot.id as string)).toBe(true);
  });

  it("produit limite: refuse sans lien explicite puis accepte avec lien", async () => {
    const producer = await createProducer();
    const productId = await seedProduct(producer.producerId, {
      pickup_availability_mode: "selected_slots",
    });
    const slotId = await seedSlot(producer.producerId);

    expect(await isAvailable(productId, slotId)).toBe(false);

    const { error } = await SUPABASE
      .from("product_slot_availabilities")
      .insert({ product_id: productId, slot_id: slotId });
    if (error) throw new Error(error.message);

    expect(await isAvailable(productId, slotId)).toBe(true);
  });

  it("creneau reserve: refuse les produits non lies puis accepte le produit lie", async () => {
    const producer = await createProducer();
    const productId = await seedProduct(producer.producerId);
    const slotId = await seedSlot(producer.producerId, {
      availability_scope: "product_restricted",
    });

    expect(await isAvailable(productId, slotId)).toBe(false);

    const { error } = await SUPABASE
      .from("product_slot_availabilities")
      .insert({ product_id: productId, slot_id: slotId });
    if (error) throw new Error(error.message);

    expect(await isAvailable(productId, slotId)).toBe(true);
  });

  it("compatibilite produit-creneau: refuse un lien entre deux producteurs", async () => {
    const producer = await createProducer();
    const otherProducer = await createProducer();
    const productId = await seedProduct(producer.producerId, {
      pickup_availability_mode: "selected_slots",
    });
    const otherSlotId = await seedSlot(otherProducer.producerId);

    expect(await isAvailable(productId, otherSlotId)).toBe(false);

    const { error } = await SUPABASE
      .from("product_slot_availabilities")
      .insert({ product_id: productId, slot_id: otherSlotId });

    const dbError = error as DbError | null;
    expect(dbError?.code).toBe("23514");
    expect(dbError?.hint).toBe("product_slot_producer_mismatch");
  });

  it("compatibilite produit-creneau: refuse produit inactif et creneau exclu", async () => {
    const producer = await createProducer();
    const inactiveProductId = await seedProduct(producer.producerId, {
      active: false,
    });
    const excludedSlotId = await seedSlot(producer.producerId, {
      excluded_at: "2026-06-01T08:00:00.000Z",
    });

    expect(await isAvailable(inactiveProductId, excludedSlotId)).toBe(false);
  });
});
