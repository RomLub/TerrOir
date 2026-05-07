/**
 * E2E concurrency/checkout-idempotency — idempotency Stripe PaymentIntent.
 *
 * Cas testé : 2 POST /api/stripe/create-payment-intent simultanés sur le
 * MÊME order par le même consumer. La route utilise une idempotencyKey
 * Stripe stable `pi_create_${order.id}` (cf. create-payment-intent/route.ts:197)
 * + un verrou DB `.is('stripe_payment_intent_id', null)` post-create avec
 * compensation cancel sur PI orphelin (T-405).
 *
 * Attendu :
 *   - 2 réponses 200
 *   - Les 2 client_secret partagent le même prefix `pi_<id>_secret_*` (même PI)
 *   - DB : orders.stripe_payment_intent_id posé à 1 seul PI
 *   - Stripe : pour le customer dédié, list({customer}) retourne au plus
 *     1 PI à l'état non-canceled (le racer perdant a été cancel par la
 *     compensation T-405).
 *
 * Note : ce test exige un STRIPE_SECRET_KEY test mode. Skip propre sinon.
 */

import Stripe from 'stripe';
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

test.describe('Concurrency — checkout idempotency', () => {
  test('2 create-payment-intent simultanés → même client_secret + 1 seul PI persisté', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(120_000);

    const stripeKey = process.env.STRIPE_SECRET_KEY ?? '';
    test.skip(
      !stripeKey.startsWith('sk_test_'),
      'STRIPE_SECRET_KEY test absent — race PI non vérifiable contre Stripe API',
    );

    const stripe = new Stripe(stripeKey, {
      apiVersion: '2026-04-22.dahlia',
      typescript: true,
    });

    const consumer = await seedConsumer(ctx, { suffix: 'race-pi-cons' });
    const producer = await seedProducer(ctx, {
      suffix: 'race-pi-prod',
      statut: 'public',
    });
    await setProducerStripeReady(producer.producerId, true);

    try {
      const product = await seedProduct(ctx, {
        producerId: producer.producerId,
        nom: `RacePI-${Date.now()}`,
        prix: 12.5,
        stockDisponible: 100,
        active: true,
      });
      const slot = await seedSlot(producer.producerId);

      await loginAs(page, consumer);

      // Setup 1 order pending (single create, pas concurrent — on isole le
      // race au niveau create-payment-intent).
      const orderRes = await page.request.post('/api/orders/create', {
        data: {
          producer_id: producer.producerId,
          slot_id: slot.id,
          date_retrait: slot.dateISO,
          items: [{ product_id: product.id, quantite: 1 }],
          cgv_accepted: true,
        },
      });
      expect(orderRes.status(), await orderRes.text()).toBe(200);
      const { order_id } = (await orderRes.json()) as { order_id: string };

      // Race : 2 POST simultanés depuis la même session consumer (cookies
      // partagés). Idempotency Stripe + verrou DB doivent garantir 1 seul PI.
      const [piRes1, piRes2] = await Promise.all([
        page.request.post('/api/stripe/create-payment-intent', {
          data: { order_id, save_card: false },
        }),
        page.request.post('/api/stripe/create-payment-intent', {
          data: { order_id, save_card: false },
        }),
      ]);

      expect(piRes1.status(), `body1=${await piRes1.text()}`).toBe(200);
      expect(piRes2.status(), `body2=${await piRes2.text()}`).toBe(200);

      const body1 = (await piRes1.json()) as { client_secret: string };
      const body2 = (await piRes2.json()) as { client_secret: string };
      expect(body1.client_secret).toMatch(/^pi_.+_secret_/);
      expect(body2.client_secret).toMatch(/^pi_.+_secret_/);

      // Le client_secret a la forme `pi_<id>_secret_<random>`. Les 2 doivent
      // référencer le même PI id (préfixe avant _secret_). On compare ce préfixe
      // pour absorber les cas où la compensation T-405 retrieve a renvoyé un
      // client_secret reformaté par Stripe (random suffix peut différer si le
      // PI a été touché entre deux appels).
      const piId1 = body1.client_secret.split('_secret_')[0];
      const piId2 = body2.client_secret.split('_secret_')[0];
      expect(piId1).toBe(piId2);

      // DB : 1 seul PI persisté sur l'order.
      const admin = getRawAdminClient();
      const { data: orderRow } = await admin
        .from('orders')
        .select('stripe_payment_intent_id')
        .eq('id', order_id)
        .single();
      expect(orderRow?.stripe_payment_intent_id).toBe(piId1);

      // Stripe API : récupère le PI retenu et vérifie cohérence.
      const winningPi = await stripe.paymentIntents.retrieve(piId1);
      expect(winningPi.metadata.order_id).toBe(order_id);
      // Le PI gagnant n'est pas canceled (compensation T-405 ne cancel que
      // l'orphelin perdant).
      expect(winningPi.status).not.toBe('canceled');

      // Stripe API : list PI pour le customer du PI gagnant. Tolérance :
      // le PI orphelin perdant peut subsister à l'état canceled si la
      // compensation a réussi son cancel. On vérifie qu'au plus 1 PI
      // non-canceled référence cet order_id.
      const customerId = typeof winningPi.customer === 'string'
        ? winningPi.customer
        : winningPi.customer?.id;
      expect(customerId).toBeTruthy();
      const customerPis = await stripe.paymentIntents.list({
        customer: customerId!,
        limit: 50,
      });
      const matchingForOrder = customerPis.data.filter(
        (p) => p.metadata?.order_id === order_id,
      );
      const liveMatching = matchingForOrder.filter((p) => p.status !== 'canceled');
      expect(liveMatching.length).toBe(1);
      expect(liveMatching[0].id).toBe(piId1);
    } finally {
      await cleanupOrdersForProducers([producer.producerId]);
    }
  });
});
