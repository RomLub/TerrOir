/**
 * E2E Phase 4 — cron /api/cron/order-timeout (annulation des orders pending +24h).
 *
 * Cible : annule les orders en statut `pending` dont `created_at < now - 24h`,
 * envoie l'email `order_timeout_cancelled` au consumer, et écrit un audit log
 * (cf app/api/cron/order-timeout/route.tsx).
 *
 * Trade-off vs vrai PI Stripe : le test seede une order pending SANS
 * `stripe_payment_intent_id` pour éviter de toucher Stripe (pas de refund
 * tenté → pas de risque Stripe). Le path testé reste celui qui annule
 * l'order et envoie l'email — branche centrale du cron.
 *
 * Pré-requis : `CRON_SECRET` set dans .env.local ; `RESEND_TEST_MODE=true`
 * activé via `npm run dev:e2e` pour la capture email (cf playwright.config).
 */

import { test, expect } from '../helpers/test-context';
import { seedConsumer, seedProducer, seedOrder } from '../helpers/db-seed';
import { cleanupOrdersForProducers } from '../helpers/order-lifecycle';
import { waitForCapturedEmail } from '../helpers/mailbox';
import { getRawAdminClient } from '../helpers/supabase-admin';

const CRON_SECRET = process.env.CRON_SECRET;
const SECRET_LOOKS_PLACEHOLDER =
  !CRON_SECRET || CRON_SECRET === 'placeholder' || CRON_SECRET.length < 16;

test.beforeAll(() => {
  if (SECRET_LOOKS_PLACEHOLDER) {
    test.skip(
      true,
      `CRON_SECRET unset or placeholder. Set a real secret in .env.local AND ` +
        `restart Next.js dev server.`,
    );
  }
});

test('order-timeout : annule order pending +24h + email order_timeout_cancelled', async ({
  page,
  ctx,
}) => {
  test.setTimeout(60_000);
  const admin = getRawAdminClient();

  // 1. Setup : producer + consumer + order pending sans PI Stripe.
  const consumer = await seedConsumer(ctx, { suffix: 'timeout-cons' });
  const producer = await seedProducer(ctx, {
    suffix: 'timeout-prod',
    statut: 'public',
  });

  const order = await seedOrder(ctx, {
    producerId: producer.producerId,
    consumerId: consumer.id,
    statut: 'pending',
    montant: 25.5,
    daysAhead: 1,
  });

  // Force created_at -25h pour matcher le filtre du cron.
  const oldTs = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const { error: updErr } = await admin
    .from('orders')
    .update({ created_at: oldTs })
    .eq('id', order.orderId);
  expect(updErr?.message ?? '').toBe('');

  try {
    // 2. Trigger cron avec CRON_SECRET valide.
    const response = await page.request.post('/api/cron/order-timeout', {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${CRON_SECRET}`,
      },
      data: '{}',
    });
    expect(
      response.status(),
      `order-timeout: ${await response.text()}`,
    ).toBe(200);

    // 3. Vérifier statut order = cancelled (pas refunded car pas de PI).
    const { data: orderRow } = await admin
      .from('orders')
      .select('statut, closure_reason, cancelled_at')
      .eq('id', order.orderId)
      .single();
    expect(orderRow?.statut).toBe('cancelled');
    expect(orderRow?.closure_reason).toBe('timeout');
    expect(orderRow?.cancelled_at).not.toBeNull();

    // 4. Vérifier email order_timeout_cancelled capturé.
    const mail = await waitForCapturedEmail(ctx, {
      to: consumer.email,
      template: 'order_timeout_cancelled',
      timeoutMs: 10_000,
    });
    expect(mail.to_email).toBe(consumer.email);
  } finally {
    await cleanupOrdersForProducers([producer.producerId]);
  }
});

test('order-timeout : sans CRON_SECRET → 401', async ({ page }) => {
  test.setTimeout(15_000);

  const response = await page.request.post('/api/cron/order-timeout', {
    headers: { 'content-type': 'application/json' },
    data: '{}',
  });
  expect(response.status()).toBe(401);
});
