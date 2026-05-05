/**
 * Smoke E2E Phase 2 audit Stripe M-3 — valide les 3 nouveaux handlers webhook
 * (radar.early_fraud_warning.created / charge.refunded / account.application.
 * deauthorized) côté side-effects DB.
 *
 * Approche : on POST directement sur /api/stripe/webhook avec un payload
 * signé via stripe.webhooks.generateTestHeaderString + le secret local
 * STRIPE_WEBHOOK_SECRET (= 'placeholder' dans .env.local), puis on vérifie
 * les écritures DB attendues.
 *
 * Trade-off vs Stripe CLI `stripe trigger` :
 *  - Stripe CLI nécessite que `stripe listen` tourne en parallèle, complexe
 *    à orchestrer en CI Playwright.
 *  - generateTestHeaderString permet un test self-contained, valide le
 *    chemin signature → switch → handler → DB sans dépendance tooling
 *    externe.
 *
 * Cas non couvert ici : radar.early_fraud_warning.created. Stripe NE déclenche
 * PAS les EFW spontanément en test mode (signal Visa/MC réel uniquement). On
 * pourrait simuler via webhook signé comme les 2 autres, mais comme le
 * payload EFW n'est pas exposé sans ressource Stripe parente, le test serait
 * artificiel. Couvert par tests/lib/stripe/handle-early-fraud-warning.test.ts
 * (5 tests) côté unitaire.
 *
 * Contraintes :
 *  - Tape sur la prod-DB Supabase (pattern projet, pas d'env-test isolé).
 *  - Mode TEST Stripe (sk_test_*) — vérifié au démarrage.
 */

import Stripe from 'stripe';
import { test, expect } from './helpers/test-context';
import { createTestProducer } from './helpers/producer-lifecycle';
import { createTestUser } from './helpers/user-lifecycle';
import { getRawAdminClient } from './helpers/supabase-admin';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-04-22.dahlia',
  typescript: true,
});

// Le webhook secret doit matcher STRIPE_WEBHOOK_SECRET côté Next.js serveur.
// Local : 'placeholder' (cf .env.local), CI : à set via secret CI dédié.
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? 'placeholder';

test.beforeAll(() => {
  const key = process.env.STRIPE_SECRET_KEY ?? '';
  if (!key.startsWith('sk_test_')) {
    throw new Error(
      `STRIPE_SECRET_KEY n'est pas une clé test (prefix=${key.slice(0, 8)}). ` +
        `Ce smoke émet des webhooks signés, refus en LIVE.`,
    );
  }
});

/**
 * Construit un payload d'event Stripe + signature valide pour POST direct
 * sur /api/stripe/webhook. Aligné avec le contrat de signature côté serveur
 * (lib/stripe/server.ts → stripe.webhooks.constructEvent).
 */
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

test('M-3 charge.refunded → audit log stripe_charge_refunded_settled posé', async ({
  page,
  ctx,
}) => {
  test.setTimeout(60_000);
  const admin = getRawAdminClient();

  // 1. Setup : producer + consumer + order avec stripe_payment_intent_id.
  const producer = await createTestProducer(ctx, {
    suffix: 'm3-refund',
    statut: 'public',
  });
  const consumer = await createTestUser(ctx, { suffix: 'm3-refund-cons' });

  const fakePiId = `pi_test_m3_refund_${Date.now()}`;
  const fakeChargeId = `ch_test_m3_refund_${Date.now()}`;

  // Slot + product minimal pour FK.
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);
  const slotEnd = new Date(tomorrow);
  slotEnd.setHours(11, 0, 0, 0);

  const { data: slot } = await admin
    .from('slots')
    .insert({
      producer_id: producer.producerId,
      starts_at: tomorrow.toISOString(),
      ends_at: slotEnd.toISOString(),
      capacity_per_slot: 5,
      active: true,
    })
    .select('id')
    .single();

  const { data: order, error: orderErr } = await admin
    .from('orders')
    .insert({
      consumer_id: consumer.id,
      producer_id: producer.producerId,
      slot_id: slot!.id as string,
      date_retrait: tomorrow.toISOString().slice(0, 10),
      heure_retrait: '10:00:00',
      statut: 'refunded',
      closure_reason: 'admin_refund',
      cancelled_at: new Date().toISOString(),
      stripe_payment_intent_id: fakePiId,
      montant_total: 25.0,
      commission_terroir: 1.5,
      montant_net_producteur: 23.5,
    })
    .select('id, code_commande')
    .single();
  expect(orderErr, `INSERT order: ${orderErr?.message ?? ''}`).toBeNull();

  // 2. POST webhook signé.
  const { payload, signature } = makeSignedWebhookPost({
    id: `evt_m3_refund_${Date.now()}`,
    type: 'charge.refunded',
    data: {
      object: {
        id: fakeChargeId,
        object: 'charge',
        amount: 2500,
        amount_refunded: 2500,
        currency: 'eur',
        payment_intent: fakePiId,
        refunded: true,
        refunds: {
          object: 'list',
          data: [{ id: `re_test_m3_${Date.now()}` }],
          has_more: false,
          url: `/v1/charges/${fakeChargeId}/refunds`,
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
    `webhook charge.refunded: ${await response.text()}`,
  ).toBe(200);

  // 3. Vérifier l'audit log posé.
  // Petite latence : audit log est posé synchrone dans le handler avant ack 200.
  const { data: auditRows } = await admin
    .from('audit_logs')
    .select('event_type, metadata')
    .eq('event_type', 'stripe_charge_refunded_settled')
    .order('created_at', { ascending: false })
    .limit(20);

  const matchingRow = (auditRows ?? []).find((r) => {
    const meta = r.metadata as { charge_id?: string; order_id?: string };
    return meta?.charge_id === fakeChargeId && meta?.order_id === order!.id;
  });
  expect(
    matchingRow,
    `audit_log stripe_charge_refunded_settled non trouvé pour charge=${fakeChargeId}`,
  ).toBeTruthy();

  // 4. Cleanup explicite (les rows ne sont pas dans trackedRowIds).
  await admin.from('orders').delete().eq('id', order!.id);
  await admin.from('slots').delete().eq('id', slot!.id as string);
});

test('M-3 account.application.deauthorized → producer flags reset + statut=suspended', async ({
  page,
  ctx,
}) => {
  test.setTimeout(60_000);
  const admin = getRawAdminClient();

  // 1. Setup : producer avec stripe_account_id réel (créé via API Stripe pour
  // que le webhook simulé soit cohérent côté event.account).
  const producer = await createTestProducer(ctx, {
    suffix: 'm3-deauth',
    statut: 'active',
  });

  const account = await stripe.accounts.create({
    type: 'express',
    country: 'FR',
    email: producer.user.email,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    business_type: 'individual',
  });

  const { error: setError } = await admin
    .from('producers')
    .update({
      stripe_account_id: account.id,
      stripe_charges_enabled: true,
      stripe_payouts_enabled: true,
      stripe_details_submitted: true,
    })
    .eq('id', producer.producerId);
  expect(setError, `seed producer flags: ${setError?.message ?? ''}`).toBeNull();

  // 2. POST webhook signé. event.data.object = Stripe.Application,
  // event.account = stripe_account_id du producer déauthorisé.
  const { payload, signature } = makeSignedWebhookPost({
    id: `evt_m3_deauth_${Date.now()}`,
    type: 'account.application.deauthorized',
    account: account.id,
    data: {
      object: {
        id: 'ca_test_application_terroir',
        object: 'application',
        name: 'TerrOir',
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
    `webhook account.application.deauthorized: ${await response.text()}`,
  ).toBe(200);

  // 3. Vérifier les flags producer reset + statut=suspended.
  const { data: row } = await admin
    .from('producers')
    .select(
      'stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted, statut',
    )
    .eq('id', producer.producerId)
    .single();

  expect(row?.stripe_account_id).toBeNull();
  expect(row?.stripe_charges_enabled).toBe(false);
  expect(row?.stripe_payouts_enabled).toBe(false);
  expect(row?.stripe_details_submitted).toBe(false);
  expect(row?.statut).toBe('suspended');

  // 4. Cleanup Stripe (le producer est cleané via auth.users CASCADE).
  try {
    await stripe.accounts.del(account.id);
  } catch (err) {
    console.warn(
      `[m3-deauth] stripe.accounts.del(${account.id}) failed: ${(err as Error).message} — non bloquant`,
    );
  }
});

// Cas radar.early_fraud_warning.created : non testé E2E.
// Justification : Stripe ne déclenche pas EFW en test mode spontanément, et
// simuler le payload via webhook signé serait artificiel sans ressource EFW
// parente (l'objet aurait un id `issfr_*` non listé dans Stripe Dashboard).
// Couverture suffisante côté unitaire :
// tests/lib/stripe/handle-early-fraud-warning.test.ts (5 cases : nominal,
// no_order_match, already_refunded, refund_failed, charge.retrieve fallback).
test.skip('M-3 radar.early_fraud_warning.created → couvert unitairement (Stripe ne trigger pas EFW en test mode)', () => {
  // intentionally empty
});
