/**
 * E2E concurrency/slot-capacity-race — race condition sur slot capacity check.
 *
 * Cas testé : 2 consumers POST /api/orders/create simultanés sur le MÊME
 * slot avec capacity_per_slot=1 mais sur 2 produits distincts (pour ne pas
 * mélanger avec stock-race). La RPC create_order_with_items pose un
 * `FOR UPDATE` sur slots.id puis `count(*)` des orders pending+confirmed+ready
 * du slot et raise `errcode='23514' hint='slot_full'` côté perdant
 * (cf. migration 20260430010000:113-127).
 *
 * Attendu :
 *   - 1 réponse 200 (order created)
 *   - 1 réponse 409 (sqlstateToStatus('23514')=409, hint='slot_full')
 *   - DB final : 1 seule order pour le slot
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

test.describe('Concurrency — slot capacity race', () => {
  test('2 commandes simultanées sur slot capacity=1 → 1 success + 1 slot_full', async ({
    browser,
    ctx,
  }) => {
    test.setTimeout(120_000);

    const producer = await seedProducer(ctx, {
      suffix: 'race-cap-prod',
      statut: 'public',
    });
    await setProducerStripeReady(producer.producerId, true);
    const consumer1 = await seedConsumer(ctx, { suffix: 'race-cap-c1' });
    const consumer2 = await seedConsumer(ctx, { suffix: 'race-cap-c2' });

    try {
      // 2 produits distincts pour isoler le slot capacity de la race stock.
      const product1 = await seedProduct(ctx, {
        producerId: producer.producerId,
        nom: `RaceCap-A-${Date.now()}`,
        prix: 9.99,
        stockDisponible: 100,
        active: true,
      });
      const product2 = await seedProduct(ctx, {
        producerId: producer.producerId,
        nom: `RaceCap-B-${Date.now()}`,
        prix: 12.5,
        stockDisponible: 100,
        active: true,
      });
      const slot = await seedSlot(producer.producerId, 1);

      const ctx1 = await browser.newContext();
      const ctx2 = await browser.newContext();
      try {
        const page1 = await ctx1.newPage();
        const page2 = await ctx2.newPage();
        await loginAs(page1, consumer1);
        await loginAs(page2, consumer2);

        const baseBody = {
          producer_id: producer.producerId,
          slot_id: slot.id,
          date_retrait: slot.dateISO,
          cgv_accepted: true,
        };

        const [res1, res2] = await Promise.all([
          page1.request.post('/api/orders/create', {
            data: { ...baseBody, items: [{ product_id: product1.id, quantite: 1 }] },
          }),
          page2.request.post('/api/orders/create', {
            data: { ...baseBody, items: [{ product_id: product2.id, quantite: 1 }] },
          }),
        ]);

        const statuses = [res1.status(), res2.status()].sort();
        expect(statuses, `body1=${await res1.text()} body2=${await res2.text()}`).toEqual([200, 409]);

        const losingRes = res1.status() === 409 ? res1 : res2;
        const losingBody = await losingRes.json();
        expect(losingBody.hint).toBe('slot_full');

        // DB : 1 seule order pour ce slot.
        const admin = getRawAdminClient();
        const { data: orders } = await admin
          .from('orders')
          .select('id, statut')
          .eq('slot_id', slot.id);
        expect(orders?.length).toBe(1);
        expect(orders?.[0]?.statut).toBe('pending');
      } finally {
        await ctx1.close();
        await ctx2.close();
      }
    } finally {
      await cleanupOrdersForProducers([producer.producerId]);
    }
  });
});
