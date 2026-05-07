/**
 * E2E Phase 4 — cron /api/cron/reminder-consumer (rappel J-1 retrait).
 *
 * Cible : sélectionne les orders confirmed avec date_retrait = demain (UTC),
 * envoie email order_reminder_consumer au consumer.
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
    test.skip(true, `CRON_SECRET unset or placeholder.`);
  }
});

test('reminder-consumer : email order_reminder_consumer envoyé pour confirmed J-1', async ({
  page,
  ctx,
}) => {
  test.setTimeout(60_000);
  const admin = getRawAdminClient();

  const consumer = await seedConsumer(ctx, { suffix: 'reminder-cons' });
  const producer = await seedProducer(ctx, {
    suffix: 'reminder-prod',
    statut: 'public',
    nomExploitation: 'Ferme Test Reminder',
  });

  const order = await seedOrder(ctx, {
    producerId: producer.producerId,
    consumerId: consumer.id,
    statut: 'confirmed',
    montant: 18,
    daysAhead: 1,
  });

  // Force date_retrait = demain UTC pour matcher le filtre du cron.
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowIso = tomorrow.toISOString().slice(0, 10);
  const { error: dateErr } = await admin
    .from('orders')
    .update({ date_retrait: tomorrowIso })
    .eq('id', order.orderId);
  expect(dateErr?.message ?? '').toBe('');

  try {
    const response = await page.request.post(
      '/api/cron/reminder-consumer',
      {
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${CRON_SECRET}`,
        },
        data: '{}',
      },
    );
    expect(
      response.status(),
      `reminder-consumer: ${await response.text()}`,
    ).toBe(200);

    const mail = await waitForCapturedEmail(ctx, {
      to: consumer.email,
      template: 'order_reminder_consumer',
      timeoutMs: 10_000,
    });
    expect(mail.to_email).toBe(consumer.email);
  } finally {
    await cleanupOrdersForProducers([producer.producerId]);
  }
});
