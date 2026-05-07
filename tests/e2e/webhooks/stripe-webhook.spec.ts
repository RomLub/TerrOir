/**
 * E2E Phase 4 — webhook Stripe POST /api/stripe/webhook (events principaux).
 *
 * Couvre 3 events critiques (cf app/api/stripe/webhook/route.tsx) :
 *   - charge.dispute.created       → INSERT public.disputes + audit log
 *   - account.updated              → UPDATE producers stripe_*_enabled flags
 *   - payment_intent.payment_failed → handle-payment-failed (UPDATE order
 *                                     statut=cancelled + closure_reason)
 *
 * Pattern aligné sur stripe-webhooks-m3.spec.ts (RACINE — référence) :
 * generateTestHeaderString self-contained, pas de dépendance Stripe CLI.
 */

import Stripe from 'stripe';
import { test, expect } from '../helpers/test-context';
import { seedConsumer, seedProducer, seedOrder } from '../helpers/db-seed';
import { cleanupOrdersForProducers } from '../helpers/order-lifecycle';
import { getRawAdminClient } from '../helpers/supabase-admin';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-04-22.dahlia',
  typescript: true,
});

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? 'placeholder';

test.beforeAll(() => {
  const key = process.env.STRIPE_SECRET_KEY ?? '';
  if (!key.startsWith('sk_test_')) {
    throw new Error(
      `STRIPE_SECRET_KEY n'est pas une clé test (prefix=${key.slice(0, 8)}). ` +
        `Refus en LIVE.`,
    );
  }
});

function makeSignedWebhookPost(eventObject: {
  id: string;
  type: string;
  data: { object: unknown };
  account?: string;
}): { payload: string; signature: string } {
  const fullEvent = {
    id: eventObject.id,
    object: 'event',
    api_version: '2026-04-22.dahlia',
    created: Math.floor(Date.now() / 1000),
    type: eventObject.type,
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    data: eventObject.data,
    ...(eventObject.account ? { account: eventObject.account } : {}),
  };
  const payload = JSON.stringify(fullEvent);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });
  return { payload, signature };
}

test('Stripe webhook charge.dispute.created → INSERT public.disputes + audit log', async ({
  page,
  ctx,
}) => {
  test.setTimeout(60_000);
  const admin = getRawAdminClient();

  const consumer = await seedConsumer(ctx, { suffix: 'wh-disp-cons' });
  const producer = await seedProducer(ctx, {
    suffix: 'wh-disp-prod',
    statut: 'public',
  });

  const piId = `pi_test_pwe2e_disp_${Date.now()}`;
  const chargeId = `ch_test_pwe2e_disp_${Date.now()}`;
  const disputeId = `dp_test_pwe2e_${Date.now()}`;

  // Order avec stripe_payment_intent_id pour que le handler retrouve l'order.
  const order = await seedOrder(ctx, {
    producerId: producer.producerId,
    consumerId: consumer.id,
    statut: 'completed',
    montant: 40,
  });
  const { error: piErr } = await admin
    .from('orders')
    .update({ stripe_payment_intent_id: piId })
    .eq('id', order.orderId);
  expect(piErr?.message ?? '').toBe('');

  try {
    const { payload, signature } = makeSignedWebhookPost({
      id: `evt_pwe2e_disp_created_${Date.now()}`,
      type: 'charge.dispute.created',
      data: {
        object: {
          id: disputeId,
          object: 'dispute',
          amount: 4000,
          currency: 'eur',
          charge: chargeId,
          payment_intent: piId,
          reason: 'fraudulent',
          status: 'needs_response',
          evidence_details: {
            due_by: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
          },
        },
      },
    });

    const response = await page.request.post('/api/stripe/webhook', {
      headers: {
        'stripe-signature': signature,
        'content-type': 'application/json',
      },
      data: payload,
    });
    expect(
      response.status(),
      `webhook charge.dispute.created: ${await response.text()}`,
    ).toBe(200);

    // 1. Row public.disputes créée pour cet order.
    const { data: disputeRow } = await admin
      .from('disputes')
      .select('order_id, status, reason, amount, stripe_dispute_id')
      .eq('stripe_dispute_id', disputeId)
      .maybeSingle();
    expect(disputeRow).not.toBeNull();
    expect(disputeRow?.order_id).toBe(order.orderId);
    expect(disputeRow?.status).toBe('needs_response');

    // 2. Audit log stripe_dispute posé.
    const { data: auditRows } = await admin
      .from('audit_logs')
      .select('event_type, metadata')
      .eq('event_type', 'stripe_dispute')
      .order('created_at', { ascending: false })
      .limit(20);
    const matching = (auditRows ?? []).find(
      (r: { metadata: Record<string, unknown> }) =>
        (r.metadata as { dispute_id?: string }).dispute_id === disputeId,
    );
    expect(matching, 'audit_log stripe_dispute').toBeTruthy();

    // Cleanup dispute + audit log + webhook_events_processed dedup.
    await admin.from('disputes').delete().eq('stripe_dispute_id', disputeId);
    await admin
      .from('audit_logs')
      .delete()
      .eq('event_type', 'stripe_dispute')
      .filter('metadata->>dispute_id', 'eq', disputeId);
  } finally {
    await cleanupOrdersForProducers([producer.producerId]);
  }
});

test('Stripe webhook account.updated → sync producers stripe_*_enabled flags', async ({
  page,
  ctx,
}) => {
  test.setTimeout(60_000);
  const admin = getRawAdminClient();

  const producer = await seedProducer(ctx, {
    suffix: 'wh-acct-prod',
    statut: 'active',
  });

  // Pose un stripe_account_id factice pour matcher l'UPDATE handler.
  const fakeAccountId = `acct_test_pwe2e_${Date.now()}`;
  const { error: setErr } = await admin
    .from('producers')
    .update({
      stripe_account_id: fakeAccountId,
      stripe_charges_enabled: false,
      stripe_payouts_enabled: false,
      stripe_details_submitted: false,
    })
    .eq('id', producer.producerId);
  expect(setErr?.message ?? '').toBe('');

  const { payload, signature } = makeSignedWebhookPost({
    id: `evt_pwe2e_acct_updated_${Date.now()}`,
    type: 'account.updated',
    account: fakeAccountId,
    data: {
      object: {
        id: fakeAccountId,
        object: 'account',
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
      },
    },
  });

  const response = await page.request.post('/api/stripe/webhook', {
    headers: {
      'stripe-signature': signature,
      'content-type': 'application/json',
    },
    data: payload,
  });
  expect(
    response.status(),
    `webhook account.updated: ${await response.text()}`,
  ).toBe(200);

  const { data: row } = await admin
    .from('producers')
    .select(
      'stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted',
    )
    .eq('id', producer.producerId)
    .single();
  expect(row?.stripe_charges_enabled).toBe(true);
  expect(row?.stripe_payouts_enabled).toBe(true);
  expect(row?.stripe_details_submitted).toBe(true);
});

test('Stripe webhook payment_intent.payment_failed → order statut→cancelled + closure_reason=payment_failed', async ({
  page,
  ctx,
}) => {
  test.setTimeout(60_000);
  const admin = getRawAdminClient();

  const consumer = await seedConsumer(ctx, { suffix: 'wh-pi-fail-cons' });
  const producer = await seedProducer(ctx, {
    suffix: 'wh-pi-fail-prod',
    statut: 'public',
  });

  const piId = `pi_test_pwe2e_fail_${Date.now()}`;
  const order = await seedOrder(ctx, {
    producerId: producer.producerId,
    consumerId: consumer.id,
    statut: 'pending',
    montant: 22,
  });
  const { error: piErr } = await admin
    .from('orders')
    .update({ stripe_payment_intent_id: piId })
    .eq('id', order.orderId);
  expect(piErr?.message ?? '').toBe('');

  try {
    // handle-payment-failed exige metadata.order_id sinon no-op (cf
    // lib/stripe/handle-payment-failed.ts:54).
    const { payload, signature } = makeSignedWebhookPost({
      id: `evt_pwe2e_pi_fail_${Date.now()}`,
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: piId,
          object: 'payment_intent',
          amount: 2200,
          currency: 'eur',
          status: 'requires_payment_method',
          metadata: { order_id: order.orderId },
          last_payment_error: {
            code: 'card_declined',
            message: 'Your card was declined.',
            type: 'card_error',
          },
        },
      },
    });

    const response = await page.request.post('/api/stripe/webhook', {
      headers: {
        'stripe-signature': signature,
        'content-type': 'application/json',
      },
      data: payload,
    });
    expect(
      response.status(),
      `webhook payment_intent.payment_failed: ${await response.text()}`,
    ).toBe(200);

    const { data: orderRow } = await admin
      .from('orders')
      .select('statut, closure_reason')
      .eq('id', order.orderId)
      .single();
    expect(orderRow?.statut).toBe('cancelled');
    expect(orderRow?.closure_reason).toBe('payment_failed');
  } finally {
    await cleanupOrdersForProducers([producer.producerId]);
  }
});
