import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import {
  getSqlIntegrationAnonClient,
  getSqlIntegrationClient,
  isLocalSupabaseReachable,
} from "./helpers/client";
import {
  cleanupAuthenticatedSession,
  seedAuthenticatedClient,
  type AuthenticatedSession,
} from "./helpers/auth";

const SUPABASE = getSqlIntegrationClient();
const TEST_PASSWORD = "test-password-create-order-rpc";

type ProducerSession = {
  userId: string;
  producerId: string;
  email: string;
  client: SupabaseClient;
};

type RpcError = {
  code?: string;
  hint?: string | null;
  message?: string;
};

const reachable = await isLocalSupabaseReachable();
const describeIfLocal = reachable ? describe : describe.skip;

async function seedProducerSession(
  overrides?: Partial<{ statut: string }>,
): Promise<ProducerSession> {
  const email = `create-order-prod-${crypto.randomUUID().slice(0, 8)}@test.local`;
  const { data: authData, error: authErr } = await SUPABASE.auth.admin
    .createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
  if (authErr || !authData.user) {
    throw new Error(`seedProducerSession auth.createUser: ${authErr?.message}`);
  }
  const userId = authData.user.id;

  const { error: userErr } = await SUPABASE.from("users").insert({
    id: userId,
    email,
    roles: ["consumer", "producer"],
  });
  if (userErr) {
    await SUPABASE.auth.admin.deleteUser(userId);
    throw new Error(`seedProducerSession users insert: ${userErr.message}`);
  }

  const { data: producer, error: producerErr } = await SUPABASE
    .from("producers")
    .insert({
      user_id: userId,
      slug: `create-order-prod-${crypto.randomUUID().slice(0, 8)}`,
      statut: overrides?.statut ?? "public",
      nom_exploitation: "Ferme test create_order_with_items",
    })
    .select("id")
    .single();
  if (producerErr || !producer) {
    await SUPABASE.from("users").delete().eq("id", userId);
    await SUPABASE.auth.admin.deleteUser(userId);
    throw new Error(`seedProducerSession producers insert: ${producerErr?.message}`);
  }

  const client = getSqlIntegrationAnonClient();
  const { error: signInErr } = await client.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });
  if (signInErr) {
    await SUPABASE.from("producers").delete().eq("id", producer.id);
    await SUPABASE.from("users").delete().eq("id", userId);
    await SUPABASE.auth.admin.deleteUser(userId);
    throw new Error(`seedProducerSession signInWithPassword: ${signInErr.message}`);
  }

  return { userId, producerId: producer.id, email, client };
}

async function seedSlot(
  producerId: string,
  overrides?: Partial<{
    active: boolean;
    capacity_per_slot: number;
    starts_at: string;
    ends_at: string;
    availability_scope: "shared" | "product_restricted";
  }>,
): Promise<string> {
  const { data, error } = await SUPABASE
    .from("slots")
    .insert({
      producer_id: producerId,
      rule_id: null,
      starts_at: overrides?.starts_at ?? "2026-06-02T09:00:00+02:00",
      ends_at: overrides?.ends_at ?? "2026-06-02T10:00:00+02:00",
      capacity_per_slot: overrides?.capacity_per_slot ?? 2,
      active: overrides?.active ?? true,
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
    active: boolean;
    stock_disponible: number;
    stock_illimite: boolean;
    pickup_availability_mode: "all_shared_slots" | "selected_slots";
  }>,
): Promise<string> {
  const { data, error } = await SUPABASE
    .from("products")
    .insert({
      producer_id: producerId,
      nom: `Produit test ${crypto.randomUUID().slice(0, 8)}`,
      prix: 12.5,
      unite: "kg",
      active: overrides?.active ?? true,
      stock_disponible: overrides?.stock_disponible ?? 10,
      stock_illimite: overrides?.stock_illimite ?? false,
      pickup_availability_mode:
        overrides?.pickup_availability_mode ?? "all_shared_slots",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seedProduct: ${error?.message}`);
  return data.id;
}

async function callCreateOrder(
  client: SupabaseClient,
  args: {
    consumerId: string;
    producerId: string;
    slotId: string;
    productId: string;
    quantity?: number;
  },
) {
  return client.rpc("create_order_with_items", {
    p_consumer_id: args.consumerId,
    p_producer_id: args.producerId,
    p_slot_id: args.slotId,
    p_date_retrait: "2026-06-02",
    p_heure_retrait: "09:00:00",
    p_notes_client: null,
    p_items: [{ product_id: args.productId, quantite: args.quantity ?? 1 }],
  });
}

function expectRpcError(
  error: unknown,
  expected: { code: string; hint?: string | null },
) {
  const rpcError = error as RpcError | null;
  expect(rpcError).not.toBeNull();
  expect(rpcError?.code).toBe(expected.code);
  if ("hint" in expected) {
    expect(rpcError?.hint ?? null).toBe(expected.hint ?? null);
  }
}

describeIfLocal("create_order_with_items", () => {
  let consumerSession: AuthenticatedSession | null = null;
  const producerSessions: ProducerSession[] = [];
  const producerIds: string[] = [];

  beforeAll(() => {
    if (!reachable) {
      console.warn(
        "[create_order_with_items] Supabase locale non joignable, tests SQL skippes.",
      );
    }
  });

  afterEach(async () => {
    if (producerIds.length > 0) {
      await SUPABASE.from("orders").delete().in("producer_id", producerIds);
      await SUPABASE.from("products").delete().in("producer_id", producerIds);
      await SUPABASE.from("slots").delete().in("producer_id", producerIds);
      await SUPABASE.from("unavailabilities")
        .delete()
        .in("producer_id", producerIds);
      await SUPABASE.from("producers").delete().in("id", producerIds);
    }

    for (const producer of producerSessions) {
      await producer.client.auth.signOut().catch(() => undefined);
      await SUPABASE.from("users").delete().eq("id", producer.userId);
      await SUPABASE.auth.admin.deleteUser(producer.userId);
    }

    if (consumerSession) {
      await cleanupAuthenticatedSession(SUPABASE, consumerSession);
    }

    consumerSession = null;
    producerSessions.length = 0;
    producerIds.length = 0;
  });

  async function seedProducer(
    overrides?: Partial<{ statut: string }>,
  ): Promise<ProducerSession> {
    const producer = await seedProducerSession(overrides);
    producerSessions.push(producer);
    producerIds.push(producer.producerId);
    return producer;
  }

  async function seedConsumer(): Promise<AuthenticatedSession> {
    consumerSession = await seedAuthenticatedClient(SUPABASE, {
      emailPrefix: "create-order-consumer",
    });
    return consumerSession;
  }

  it("commande valide: utilise slots.active/products.active et cree la commande", async () => {
    const producer = await seedProducer();
    const consumer = await seedConsumer();
    const slotId = await seedSlot(producer.producerId);
    const productId = await seedProduct(producer.producerId);

    const { data: orderId, error } = await callCreateOrder(consumer.client, {
      consumerId: consumer.userId,
      producerId: producer.producerId,
      slotId,
      productId,
    });

    expect(error).toBeNull();
    expect(orderId).toEqual(expect.any(String));

    const { data: product } = await SUPABASE
      .from("products")
      .select("stock_disponible")
      .eq("id", productId)
      .single();
    expect(Number(product?.stock_disponible)).toBe(9);
  });

  it("produit limite compatible: accepte avec lien produit-creneau", async () => {
    const producer = await seedProducer();
    const consumer = await seedConsumer();
    const slotId = await seedSlot(producer.producerId);
    const productId = await seedProduct(producer.producerId, {
      pickup_availability_mode: "selected_slots",
    });

    const { error: linkErr } = await SUPABASE
      .from("product_slot_availabilities")
      .insert({ product_id: productId, slot_id: slotId });
    if (linkErr) throw new Error(linkErr.message);

    const { data: orderId, error } = await callCreateOrder(consumer.client, {
      consumerId: consumer.userId,
      producerId: producer.producerId,
      slotId,
      productId,
    });

    expect(error).toBeNull();
    expect(orderId).toEqual(expect.any(String));
  });

  it("produit limite incompatible: refuse avec product_slot_unavailable", async () => {
    const producer = await seedProducer();
    const consumer = await seedConsumer();
    const slotId = await seedSlot(producer.producerId);
    const productId = await seedProduct(producer.producerId, {
      pickup_availability_mode: "selected_slots",
    });

    const { error } = await callCreateOrder(consumer.client, {
      consumerId: consumer.userId,
      producerId: producer.producerId,
      slotId,
      productId,
    });

    expectRpcError(error, {
      code: "23514",
      hint: "product_slot_unavailable",
    });
  });

  it("creneau reserve a d'autres produits: refuse avec product_slot_unavailable", async () => {
    const producer = await seedProducer();
    const consumer = await seedConsumer();
    const slotId = await seedSlot(producer.producerId, {
      availability_scope: "product_restricted",
    });
    const productId = await seedProduct(producer.producerId);
    const linkedProductId = await seedProduct(producer.producerId);

    const { error: linkErr } = await SUPABASE
      .from("product_slot_availabilities")
      .insert({ product_id: linkedProductId, slot_id: slotId });
    if (linkErr) throw new Error(linkErr.message);

    const { error } = await callCreateOrder(consumer.client, {
      consumerId: consumer.userId,
      producerId: producer.producerId,
      slotId,
      productId,
    });

    expectRpcError(error, {
      code: "23514",
      hint: "product_slot_unavailable",
    });
  });

  it("stock insuffisant: refuse avec l'erreur structuree stock_depleted", async () => {
    const producer = await seedProducer();
    const consumer = await seedConsumer();
    const slotId = await seedSlot(producer.producerId);
    const productId = await seedProduct(producer.producerId, {
      stock_disponible: 1,
    });

    const { error } = await callCreateOrder(consumer.client, {
      consumerId: consumer.userId,
      producerId: producer.producerId,
      slotId,
      productId,
      quantity: 2,
    });

    expectRpcError(error, { code: "23514", hint: "stock_depleted" });
  });

  it("creneau inactif: refuse avec slot_invalid", async () => {
    const producer = await seedProducer();
    const consumer = await seedConsumer();
    const slotId = await seedSlot(producer.producerId, { active: false });
    const productId = await seedProduct(producer.producerId);

    const { error } = await callCreateOrder(consumer.client, {
      consumerId: consumer.userId,
      producerId: producer.producerId,
      slotId,
      productId,
    });

    expectRpcError(error, { code: "23514", hint: "slot_invalid" });
  });

  it("creneau plein: refuse avec slot_full", async () => {
    const producer = await seedProducer();
    const consumer = await seedConsumer();
    const slotId = await seedSlot(producer.producerId, {
      capacity_per_slot: 1,
    });
    const productId = await seedProduct(producer.producerId);

    const { error: seedOrderErr } = await SUPABASE.from("orders").insert({
      consumer_id: consumer.userId,
      producer_id: producer.producerId,
      slot_id: slotId,
      statut: "pending",
      montant_total: 10,
      date_retrait: "2026-06-02",
      heure_retrait: "09:00:00",
    });
    if (seedOrderErr) throw new Error(seedOrderErr.message);

    const { error } = await callCreateOrder(consumer.client, {
      consumerId: consumer.userId,
      producerId: producer.producerId,
      slotId,
      productId,
    });

    expectRpcError(error, { code: "23514", hint: "slot_full" });
  });

  it("creneau indisponible: refuse avec slot_unavailable", async () => {
    const producer = await seedProducer();
    const consumer = await seedConsumer();
    const slotId = await seedSlot(producer.producerId);
    const productId = await seedProduct(producer.producerId);

    const { error: unavailabilityErr } = await SUPABASE
      .from("unavailabilities")
      .insert({
        producer_id: producer.producerId,
        date: "2026-06-02",
        created_by: producer.userId,
      });
    if (unavailabilityErr) throw new Error(unavailabilityErr.message);

    const { error } = await callCreateOrder(consumer.client, {
      consumerId: consumer.userId,
      producerId: producer.producerId,
      slotId,
      productId,
    });

    expectRpcError(error, { code: "23514", hint: "slot_unavailable" });
  });

  it("produit inactif: refuse la commande", async () => {
    const producer = await seedProducer();
    const consumer = await seedConsumer();
    const slotId = await seedSlot(producer.producerId);
    const productId = await seedProduct(producer.producerId, { active: false });

    const { error } = await callCreateOrder(consumer.client, {
      consumerId: consumer.userId,
      producerId: producer.producerId,
      slotId,
      productId,
    });

    expectRpcError(error, { code: "42501" });
  });

  it("auto-achat producteur: refuse avant creation de commande", async () => {
    const producer = await seedProducer();
    const slotId = await seedSlot(producer.producerId);
    const productId = await seedProduct(producer.producerId);

    const { error } = await callCreateOrder(producer.client, {
      consumerId: producer.userId,
      producerId: producer.producerId,
      slotId,
      productId,
    });

    expectRpcError(error, { code: "P0001" });
  });

  it("produit hors producteur: refuse avec product_producer_mismatch", async () => {
    const producer = await seedProducer();
    const otherProducer = await seedProducer();
    const consumer = await seedConsumer();
    const slotId = await seedSlot(producer.producerId);
    const otherProductId = await seedProduct(otherProducer.producerId);

    const { error } = await callCreateOrder(consumer.client, {
      consumerId: consumer.userId,
      producerId: producer.producerId,
      slotId,
      productId: otherProductId,
    });

    expectRpcError(error, {
      code: "23514",
      hint: "product_producer_mismatch",
    });
  });
});
