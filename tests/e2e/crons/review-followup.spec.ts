/**
 * E2E Phase 4 — cron /api/cron/review-followup (relances avis J+2 / J+7).
 *
 * Cible : envoie les emails review_request_j2 / review_request_j7 pour les
 * orders completed dont `completed_at` est dans la fenêtre J-2 ou J-7
 * Europe/Paris ET dont la review n'a pas encore été créée (cf
 * app/api/cron/review-followup/route.tsx).
 *
 * Doctrine dédup : marqueur DB `orders.review_followup_d{2,7}_sent_at`.
 * Pour ce test, on seed sans marqueur posé → premier passage = email envoyé.
 * Marqueur posé AVANT sendTemplate (race-safe), donc à la fin du test la
 * colonne contient un timestamp.
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

test('review-followup : email review_request_j2 envoyé pour order completed J-2', async ({
  page,
  ctx,
}) => {
  test.setTimeout(60_000);
  const admin = getRawAdminClient();

  const consumer = await seedConsumer(ctx, { suffix: 'reviewj2-cons' });
  const producer = await seedProducer(ctx, {
    suffix: 'reviewj2-prod',
    statut: 'public',
  });

  // Order seedée en pending par défaut, on bascule completed avec
  // completed_at = J-2 (12h Paris pour atterrir bien dans la fenêtre 0-23h59
  // Paris du jour J-2 quel que soit DST).
  const order = await seedOrder(ctx, {
    producerId: producer.producerId,
    consumerId: consumer.id,
    statut: 'completed',
    montant: 10,
    daysAhead: -3,
  });

  const j2 = new Date();
  j2.setUTCDate(j2.getUTCDate() - 2);
  j2.setUTCHours(11, 0, 0, 0); // 12h ou 13h Paris suivant DST
  const { error: completedErr } = await admin
    .from('orders')
    .update({
      completed_at: j2.toISOString(),
      review_followup_d2_sent_at: null,
      review_followup_d7_sent_at: null,
    })
    .eq('id', order.orderId);
  expect(completedErr?.message ?? '').toBe('');

  try {
    const response = await page.request.post('/api/cron/review-followup', {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${CRON_SECRET}`,
      },
      data: '{}',
    });
    expect(
      response.status(),
      `review-followup: ${await response.text()}`,
    ).toBe(200);

    // Email review_request_j2 capturé.
    const mail = await waitForCapturedEmail(ctx, {
      to: consumer.email,
      template: 'review_request_j2',
      timeoutMs: 10_000,
    });
    expect(mail.to_email).toBe(consumer.email);

    // Marqueur dédup posé.
    const { data: orderRow } = await admin
      .from('orders')
      .select('review_followup_d2_sent_at')
      .eq('id', order.orderId)
      .single();
    expect(orderRow?.review_followup_d2_sent_at).not.toBeNull();
  } finally {
    await cleanupOrdersForProducers([producer.producerId]);
  }
});
