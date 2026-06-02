/**
 * Helpers de cycle de vie order pour tests E2E.
 *
 *   createTestOrder(ctx, options) : crée 1 product + 1 slot futur + 1 order +
 *   1 order_item, tous rattachés au producerId fourni. Retourne les IDs pour
 *   permettre un cleanup ciblé.
 *
 *   cleanupOrdersForProducers(producerIds[]) : purge orders + order_items pour
 *   les producer_ids fournis. Doit être appelé AVANT cleanupAllTrackedUsers
 *   (afterEach) sinon le delete de la producer row échoue (FK orders.producer_id
 *   = NO ACTION). products + slots cascade-delete depuis producers donc inutile
 *   de les purger ici.
 *
 * Pas de email check (les tables touchées n'ont pas de col email). Pas de tracking
 * automatique des row IDs : les tests passent par cleanupOrdersForProducers en
 * try/finally pour garantir la purge même en cas d'assertion failure.
 */

import { getRawAdminClient, type TestContext } from './supabase-admin';

export interface TestOrderRefs {
  orderId: string;
  orderItemId: string;
  productId: string;
  slotId: string;
  codeCommande: string;
}

interface CreateTestOrderOptions {
  producerId: string;
  consumerId: string;
  /** Marqueur unique rendu sur la page (commandes). Default = 'PWE2E-{ts}'. */
  codeCommande?: string;
  /** Nom du produit créé (rendu sur catalogue). Default = 'PRODUCT-{ts}'. */
  productNom?: string;
  /** Statut order. Default 'pending'. */
  statut?: 'pending' | 'confirmed' | 'completed';
  /** Montant total + prix_unitaire + sous_total. Default 9.99. */
  montant?: number;
  /** Jours dans le futur pour le slot. Default 1. */
  daysAhead?: number;
}

// Compteur monotone pour staggérer les starts_at de slots créés dans le même
// process (évite collision sur slots_producer_starts_at_unique = (producer_id,
// starts_at) quand 2+ seedOrder visent le même producer dans la même seconde).
let _slotSlotCounter = 0;

export async function createTestOrder(
  _ctx: TestContext,
  options: CreateTestOrderOptions,
): Promise<TestOrderRefs> {
  const admin = getRawAdminClient();
  const ts = Date.now();
  const montant = options.montant ?? 9.99;

  const productNom = options.productNom ?? `PRODUCT-${ts}`;
  const { data: product, error: productErr } = await admin
    .from('products')
    .insert({
      producer_id: options.producerId,
      nom: productNom,
      description: 'Produit test RLS isolation',
      prix: montant,
      unite: 'piece',
      stock_disponible: 100,
      stock_illimite: false,
      active: true,
    })
    .select('id')
    .single();
  if (productErr || !product) {
    throw new Error(`createTestOrder INSERT product: ${productErr?.message}`);
  }
  const productId = product.id as string;

  // Stagger starts_at par appel : daysAhead × 24h + slot_offset minutes.
  // Sans ça, 2+ seedOrder pour un même producer dans une même seconde
  // collisionnent sur slots_producer_starts_at_unique (cf. test
  // /compte/commandes "liste les 3 orders" qui crée 3 orders d'affilée).
  // Compteur global process-level garantit unicité même cross-tests dans
  // le même worker Playwright.
  const days = options.daysAhead ?? 1;
  const slotOffsetMin = ++_slotSlotCounter; // 1 min de gap entre seedOrder
  const start = new Date();
  start.setDate(start.getDate() + days);
  start.setHours(10, 0, 0, 0);
  start.setTime(start.getTime() + slotOffsetMin * 60_000);
  const end = new Date(start.getTime() + 60 * 60_000); // +1h

  const { data: slot, error: slotErr } = await admin
    .from('slots')
    .insert({
      producer_id: options.producerId,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      capacity_per_slot: 5,
      active: true,
    })
    .select('id')
    .single();
  if (slotErr || !slot) {
    throw new Error(`createTestOrder INSERT slot: ${slotErr?.message}`);
  }
  const slotId = slot.id as string;

  const dateRetrait = start.toISOString().slice(0, 10);
  // Si options.codeCommande est fourni, on le pose tel quel (cas tests
  // legacy qui asseraient sur un marqueur custom). Sinon, on laisse le
  // trigger Postgres generate_order_code() poser un code TRR valide
  // (cf. supabase/migrations/20260419000000_initial_schema.sql L284-300).
  // C'est nécessaire pour que les inputs UI (form pickup-validation
  // maxLength=12 + strip [^A-Z0-9]) acceptent le code sans tronquer.
  const orderInsertPayload: Record<string, unknown> = {
    producer_id: options.producerId,
    consumer_id: options.consumerId,
    slot_id: slotId,
    date_retrait: dateRetrait,
    heure_retrait: '10:00',
    statut: options.statut ?? 'pending',
    montant_total: montant,
  };
  if (options.codeCommande) {
    orderInsertPayload.code_commande = options.codeCommande;
  }

  const { data: order, error: orderErr } = await admin
    .from('orders')
    .insert(orderInsertPayload)
    .select('id, code_commande')
    .single();
  if (orderErr || !order) {
    throw new Error(`createTestOrder INSERT order: ${orderErr?.message}`);
  }
  const orderId = order.id as string;

  const { data: orderItem, error: itemErr } = await admin
    .from('order_items')
    .insert({
      order_id: orderId,
      product_id: productId,
      quantite: 1,
      prix_unitaire: montant,
      sous_total: montant,
    })
    .select('id')
    .single();
  if (itemErr || !orderItem) {
    throw new Error(`createTestOrder INSERT order_item: ${itemErr?.message}`);
  }

  return {
    orderId,
    orderItemId: orderItem.id as string,
    productId,
    slotId,
    codeCommande: order.code_commande as string,
  };
}

/**
 * Purge orders + order_items pour les producer_ids fournis.
 *
 * Utilise raw admin (bypass garde-fous safeDelete : on filtre par producer_id
 * qui n'est pas tracké dans le contexte, et on veut être robuste au cleanup
 * post-failure). order_items.order_id ON DELETE CASCADE → suffit de supprimer
 * orders, mais on delete order_items en explicit avant pour être défensif.
 *
 * Ne purge PAS products/slots : producers.{products,slots}.producer_id ON DELETE
 * CASCADE → cleanupAllTrackedUsers (afterEach) qui delete producers cascade
 * automatiquement.
 */
export async function cleanupOrdersForProducers(
  producerIds: string[],
): Promise<void> {
  if (producerIds.length === 0) return;
  const admin = getRawAdminClient();

  const { data: orders } = await admin
    .from('orders')
    .select('id')
    .in('producer_id', producerIds);
  const orderIds = (orders ?? []).map((r) => r.id as string);

  if (orderIds.length > 0) {
    await admin.from('order_items').delete().in('order_id', orderIds);
    await admin.from('orders').delete().in('id', orderIds);
  }
}
