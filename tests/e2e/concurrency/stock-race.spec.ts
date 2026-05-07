/**
 * E2E concurrency/stock-race — race condition sur stock_disponible décrément.
 *
 * Cas testé : 2 consumers POST /api/orders/create simultanés sur LE MÊME
 * product avec stock_disponible=1, stock_illimite=false. La RPC
 * create_order_with_items pose un `FOR UPDATE` sur products.id (cf.
 * migration 20260430010000:134-138) puis vérifie stock < quantite et raise
 * `errcode='23514' hint='stock_depleted'` côté perdant.
 *
 * Attendu :
 *   - 1 réponse 200 (order created)
 *   - 1 réponse 409 (sqlstateToStatus('23514')=409, hint='stock_depleted')
 *   - DB final : products.stock_disponible = 0
 *
 * Setup : 2 contexts browser séparés pour authentifier 2 consumers distincts
 * sur 2 sessions parallèles. Pas d'utilisation de `page.request` partagée
 * (cookies session communs → un seul user en DB pour les 2 fetches).
 */

import { test, expect } from '../helpers/test-context';
import {
  seedConsumer,
  seedProducer,
  seedProduct,
} from '../helpers/db-seed';
import { loginAs } from '../helpers/user-lifecycle';
import { cleanupOrdersForProducers } from '../helpers/order-lifecycle';
import { getRawAdminClient } from '../helpers/supabase-admin';

const TOMORROW = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return d;
};

async function seedSlot(
  producerId: string,
  capacity = 5,
  startsAt: Date = TOMORROW(),
): Promise<{ id: string; dateISO: string }> {
  const admin = getRawAdminClient();
  const end = new Date(startsAt);
  end.setHours(end.getHours() + 1);
  const { data, error } = await admin
    .from('slots')
    .insert({
      producer_id: producerId,
      starts_at: startsAt.toISOString(),
      ends_at: end.toISOString(),
      capacity_per_slot: capacity,
      active: true,
    })
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(`seedSlot failed: ${error?.message ?? 'no data'}`);
  }
  return { id: data.id as string, dateISO: startsAt.toISOString().slice(0, 10) };
}

async function setProducerStripeReady(producerId: string, ready: boolean): Promise<void> {
  const admin = getRawAdminClient();
  await admin
    .from('producers')
    .update({
      stripe_charges_enabled: ready,
      stripe_payouts_enabled: ready,
      stripe_details_submitted: ready,
    })
    .eq('id', producerId);
}

test.describe('Concurrency — stock_disponible race', () => {
  test('2 commandes simultanées sur stock=1 → 1 success + 1 stock_depleted', async ({
    browser,
    ctx,
  }) => {
    test.setTimeout(120_000);

    const producer = await seedProducer(ctx, {
      suffix: 'race-stock-prod',
      statut: 'public',
    });
    await setProducerStripeReady(producer.producerId, true);
    const consumer1 = await seedConsumer(ctx, { suffix: 'race-stock-c1' });
    const consumer2 = await seedConsumer(ctx, { suffix: 'race-stock-c2' });

    try {
      const product = await seedProduct(ctx, {
        producerId: producer.producerId,
        nom: `RaceStock-${Date.now()}`,
        prix: 9.99,
        stockDisponible: 1,
        stockIllimite: false,
        active: true,
      });
      const slot = await seedSlot(producer.producerId, 5);

      // 2 contexts browser → 2 sessions auth distinctes pour le Promise.all.
      const ctx1 = await browser.newContext();
      const ctx2 = await browser.newContext();
      try {
        const page1 = await ctx1.newPage();
        const page2 = await ctx2.newPage();
        await loginAs(page1, consumer1);
        await loginAs(page2, consumer2);

        const orderBody = {
          producer_id: producer.producerId,
          slot_id: slot.id,
          date_retrait: slot.dateISO,
          items: [{ product_id: product.id, quantite: 1 }],
          cgv_accepted: true,
        };

        const [res1, res2] = await Promise.all([
          page1.request.post('/api/orders/create', { data: orderBody }),
          page2.request.post('/api/orders/create', { data: orderBody }),
        ]);

        const statuses = [res1.status(), res2.status()].sort();
        // 1 réussit (200), 1 fail (409 mappé depuis SQLSTATE 23514).
        // Note tolérance : si la 2e a été serialisée APRÈS commit DB de la 1ère,
        // le check stock_disponible < quantite raise 23514 → 409. Si en revanche
        // la 1ère hasn't yet committed et la 2e voit aussi stock=1, le verrou
        // FOR UPDATE serialise et la 2e raise quand même 23514.
        expect(statuses, `body1=${await res1.text()} body2=${await res2.text()}`).toEqual([200, 409]);

        const losingRes = res1.status() === 409 ? res1 : res2;
        const losingBody = await losingRes.json();
        expect(losingBody.hint).toBe('stock_depleted');

        // DB : stock_disponible doit être à 0 (1 décrément réussi, pas 2).
        const admin = getRawAdminClient();
        const { data: row } = await admin
          .from('products')
          .select('stock_disponible')
          .eq('id', product.id)
          .single();
        expect(row?.stock_disponible).toBe(0);

        // Cohérence : il y a exactement 1 order créée pour ce producer.
        const { data: orders } = await admin
          .from('orders')
          .select('id')
          .eq('producer_id', producer.producerId);
        expect(orders?.length).toBe(1);
      } finally {
        await ctx1.close();
        await ctx2.close();
      }
    } finally {
      await cleanupOrdersForProducers([producer.producerId]);
    }
  });
});
