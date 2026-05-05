/**
 * Audit Stripe phase B (2026-05-05) LOT 3 — matrice 3DS Playwright.
 *
 * Couvre 4 scénarios 3DS via cartes test Stripe documentées
 * https://docs.stripe.com/testing#regulatory-cards :
 *  - 4000 0084 0000 1629 : 3DS frictionless (no challenge)
 *  - 4000 0000 0000 3055 : 3DS optional, succeed sans challenge
 *  - 4000 0027 6000 3184 : 3DS required, succeed après challenge
 *  - 4000 0000 0000 3220 : 3DS required générique (Visa)
 *
 * Approche pragmatique : on confirme le PaymentIntent côté serveur via
 * `stripe.paymentIntents.confirm` avec un PaymentMethod créé inline depuis
 * une carte test brute. C'est légitime en mode test (`sk_test_*` accepte
 * raw card data ; refus en live sauf SAQ-D, hors scope TerrOir).
 *
 * Trade-off explicite : on NE drive PAS l'iframe Stripe Elements ni l'iframe
 * 3DS (`hooks.stripe.com/3d_secure_2/...`). L'expérience smoke phase 3 a
 * montré que driver l'UI Stripe via Playwright headless est instable
 * (sélecteurs DOM Stripe non documentés, anti-bot CAPTCHA, race-conditions
 * iframe). Conséquence :
 *   - Cas frictionless / optional → testables 100% E2E (pas de challenge UI).
 *   - Cas required → on valide l'état `requires_action` + structure
 *     `next_action` retournée par Stripe, sans compléter le challenge.
 *   - Cas required + DECLINED post-challenge → SKIP avec doc, nécessite
 *     drive UI (clic "Fail Test Payment" dans iframe Stripe).
 *
 * Webhook simulé pour cas success : POST direct signé sur
 * /api/stripe/webhook (pattern stripe-webhooks-m3.spec.ts) → vérifie que
 * l'order passe à 'pending' (pas 'confirmed' — la confirmation producer se
 * fait via /api/orders/[id]/confirm, hors scope ici).
 *
 * Cleanup : refunds.create(idempotency-key cohérent) + DB rows purgés.
 *
 * Contraintes :
 *  - Mode TEST Stripe (sk_test_*) — vérifié au démarrage.
 *  - Tape sur la prod-DB Supabase (pattern projet).
 */

import Stripe from 'stripe';
import { test, expect } from './helpers/test-context';
import { createTestProducer } from './helpers/producer-lifecycle';
import { createTestUser, loginAs, type TestUser } from './helpers/user-lifecycle';
import { getRawAdminClient } from './helpers/supabase-admin';

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
        `Cette matrice 3DS confirme des PI raw card → refus en LIVE.`,
    );
  }
});

// =============================================================================
// Helpers locaux — pattern aligné sur stripe-smoke-phase3.spec.ts step C
// =============================================================================

interface SetupResult {
  producerId: string;
  consumer: TestUser;
  productId: string;
  slotId: string;
  orderId: string;
  paymentIntentId: string;
  clientSecret: string;
}

async function setupOrderWithPaymentIntent(
  page: import('@playwright/test').Page,
  ctx: import('./helpers/supabase-admin').TestContext,
  scenarioSuffix: string,
): Promise<SetupResult> {
  const admin = getRawAdminClient();

  const producer = await createTestProducer(ctx, {
    suffix: `3ds-${scenarioSuffix}`,
    statut: 'public',
  });

  // Active les flags Stripe Connect côté DB (équivalent post-onboarding KYC,
  // bypass nécessaire pour passer le guard M-6 charges_enabled).
  await admin
    .from('producers')
    .update({
      stripe_charges_enabled: true,
      stripe_payouts_enabled: true,
      stripe_details_submitted: true,
    })
    .eq('id', producer.producerId);

  const { data: product } = await admin
    .from('products')
    .insert({
      producer_id: producer.producerId,
      nom: `3DS Test Product (${scenarioSuffix})`,
      description: `Produit créé par stripe-3ds-matrix (${scenarioSuffix})`,
      prix: 12.5,
      unite: 'piece',
      poids_estime_kg: 1,
      stock_disponible: 100,
      stock_illimite: false,
      delai_preparation_jours: 1,
      active: true,
    })
    .select('id')
    .single();

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

  const consumer = await createTestUser(ctx, { suffix: `3ds-cons-${scenarioSuffix}` });
  await page.context().clearCookies();
  await loginAs(page, consumer);

  const dateRetrait = tomorrow.toISOString().slice(0, 10);

  const orderResponse = await page.request.post('/api/orders/create', {
    data: {
      producer_id: producer.producerId,
      slot_id: slot!.id as string,
      date_retrait: dateRetrait,
      items: [{ product_id: product!.id as string, quantite: 1 }],
    },
  });
  expect(orderResponse.status(), `orders/create: ${await orderResponse.text()}`).toBe(200);
  const { order_id: orderId } = (await orderResponse.json()) as { order_id: string };

  const piResponse = await page.request.post('/api/stripe/create-payment-intent', {
    data: { order_id: orderId, save_card: false },
  });
  expect(piResponse.status(), `create-payment-intent: ${await piResponse.text()}`).toBe(200);
  const { client_secret } = (await piResponse.json()) as { client_secret: string };
  const paymentIntentId = client_secret.split('_secret_')[0]!;

  return {
    producerId: producer.producerId,
    consumer,
    productId: product!.id as string,
    slotId: slot!.id as string,
    orderId,
    paymentIntentId,
    clientSecret: client_secret,
  };
}

interface ConfirmWith3DSCardOptions {
  paymentIntentId: string;
  cardNumber: string;
  cvc?: string;
  expMonth?: number;
  expYear?: number;
  returnUrl?: string;
}

async function confirmWith3DSCard(
  options: ConfirmWith3DSCardOptions,
): Promise<Stripe.PaymentIntent> {
  // 1. Crée un PaymentMethod via raw card data (test mode only).
  const paymentMethod = await stripe.paymentMethods.create({
    type: 'card',
    card: {
      number: options.cardNumber,
      exp_month: options.expMonth ?? 12,
      exp_year: options.expYear ?? new Date().getFullYear() + 4,
      cvc: options.cvc ?? '123',
    },
  });

  // 2. Confirm le PI avec ce PaymentMethod. return_url synthétique pour 3DS.
  const confirmed = await stripe.paymentIntents.confirm(options.paymentIntentId, {
    payment_method: paymentMethod.id,
    return_url: options.returnUrl ?? 'https://example.com/3ds-callback',
  });

  return confirmed;
}

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

async function cleanupSetup(setup: SetupResult): Promise<void> {
  const admin = getRawAdminClient();
  // Order_items + order
  await admin.from('order_items').delete().eq('order_id', setup.orderId);
  await admin.from('orders').delete().eq('id', setup.orderId);
  // Product + slot
  await admin.from('products').delete().eq('id', setup.productId);
  await admin.from('slots').delete().eq('id', setup.slotId);
}

async function cleanupStripePI(
  paymentIntentId: string,
  scenario: string,
): Promise<void> {
  // Refund si succeeded, cancel si encore en requires_*. Idempotency key
  // dédiée scenario (cf docs/conventions/stripe-idempotency.md — convention
  // <verb>_<entityId>_<context>).
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.status === 'succeeded') {
      await stripe.refunds.create(
        { payment_intent: paymentIntentId },
        { idempotencyKey: `refund_${paymentIntentId}_3ds_${scenario}` },
      );
    } else if (
      pi.status === 'requires_payment_method' ||
      pi.status === 'requires_confirmation' ||
      pi.status === 'requires_action'
    ) {
      await stripe.paymentIntents.cancel(paymentIntentId);
    }
  } catch (err) {
    console.warn(
      `[3ds-${scenario}] cleanup PI ${paymentIntentId} failed: ${(err as Error).message} — non bloquant`,
    );
  }
}

// =============================================================================
// Tests
// =============================================================================

test('3DS frictionless (4000 0084 0000 1629) → succeed direct sans challenge, order pending', async ({
  page,
  ctx,
}) => {
  test.setTimeout(120_000);
  const setup = await setupOrderWithPaymentIntent(page, ctx, 'frictionless');

  // Confirm avec carte 3DS frictionless : Stripe ne déclenche PAS de challenge
  // (3DS soft, pas de step-up). PI passe direct à 'succeeded'.
  const confirmed = await confirmWith3DSCard({
    paymentIntentId: setup.paymentIntentId,
    cardNumber: '4000008400001629',
  });

  expect(confirmed.status, `PI status frictionless: ${confirmed.status}`).toBe('succeeded');
  expect(confirmed.next_action).toBeNull();

  // Simul webhook payment_intent.succeeded (le webhook réel n'arrive pas en
  // local — STRIPE_WEBHOOK_SECRET=placeholder). On reconstruit l'event signé
  // depuis le PI confirmé puis POST sur la route.
  const { payload, signature } = makeSignedWebhookPost({
    id: `evt_3ds_frictionless_${Date.now()}`,
    type: 'payment_intent.succeeded',
    data: { object: confirmed as unknown as Record<string, unknown> },
  });
  const webhookResponse = await page.request.post('/api/stripe/webhook', {
    headers: {
      'stripe-signature': signature,
      'content-type': 'application/json',
    },
    data: payload,
  });
  expect(
    webhookResponse.status(),
    `webhook payment_intent.succeeded: ${await webhookResponse.text()}`,
  ).toBe(200);

  // Vérifie que l'order est passée à 'pending' (logique TerrOir : pending =
  // payée, en attente de confirmation producer ; 'confirmed' = producer accepté).
  const admin = getRawAdminClient();
  const { data: orderRow } = await admin
    .from('orders')
    .select('statut, closure_reason')
    .eq('id', setup.orderId)
    .single();
  expect(orderRow?.statut).toBe('pending');
  expect(orderRow?.closure_reason).toBeNull();

  await cleanupStripePI(setup.paymentIntentId, 'frictionless');
  await cleanupSetup(setup);
});

test('3DS optional, succeed sans challenge (4000 0000 0000 3055) → succeeded, order pending', async ({
  page,
  ctx,
}) => {
  test.setTimeout(120_000);
  const setup = await setupOrderWithPaymentIntent(page, ctx, 'optional');

  // Carte 3DS optional : Stripe peut demander un challenge selon le risque,
  // mais sur un montant faible (12.50 €) en test mode, no challenge requis.
  const confirmed = await confirmWith3DSCard({
    paymentIntentId: setup.paymentIntentId,
    cardNumber: '4000000000003055',
  });

  expect(confirmed.status, `PI status optional: ${confirmed.status}`).toBe('succeeded');

  const { payload, signature } = makeSignedWebhookPost({
    id: `evt_3ds_optional_${Date.now()}`,
    type: 'payment_intent.succeeded',
    data: { object: confirmed as unknown as Record<string, unknown> },
  });
  const webhookResponse = await page.request.post('/api/stripe/webhook', {
    headers: {
      'stripe-signature': signature,
      'content-type': 'application/json',
    },
    data: payload,
  });
  expect(webhookResponse.status()).toBe(200);

  const admin = getRawAdminClient();
  const { data: orderRow } = await admin
    .from('orders')
    .select('statut')
    .eq('id', setup.orderId)
    .single();
  expect(orderRow?.statut).toBe('pending');

  await cleanupStripePI(setup.paymentIntentId, 'optional');
  await cleanupSetup(setup);
});

test('3DS required + success (4000 0027 6000 3184) → requires_action + next_action structuré', async ({
  page,
  ctx,
}) => {
  test.setTimeout(120_000);
  const setup = await setupOrderWithPaymentIntent(page, ctx, 'required-success');

  // Carte 3DS required : Stripe pose `requires_action` + next_action use_stripe_sdk.
  // La complétion du challenge nécessiterait drive UI iframe Stripe — hors scope
  // E2E stable. On vérifie ici la structure retournée par Stripe et l'absence
  // de transition statut DB côté order (reste 'cart' jusqu'à webhook succeeded).
  const confirmed = await confirmWith3DSCard({
    paymentIntentId: setup.paymentIntentId,
    cardNumber: '4000002760003184',
  });

  expect(confirmed.status, `PI status required-success: ${confirmed.status}`).toBe(
    'requires_action',
  );
  expect(confirmed.next_action).toBeTruthy();
  // Stripe retourne soit use_stripe_sdk (PaymentElement-driven), soit
  // redirect_to_url (legacy). Les deux sont valides pour 3DS step-up.
  expect(['use_stripe_sdk', 'redirect_to_url']).toContain(confirmed.next_action!.type);

  // L'order côté DB doit rester en statut initial (pas de webhook succeeded
  // émis tant que le challenge n'est pas complété).
  const admin = getRawAdminClient();
  const { data: orderRow } = await admin
    .from('orders')
    .select('statut')
    .eq('id', setup.orderId)
    .single();
  // Statut initial ='cart' (avant payment_intent.succeeded), pas 'pending'.
  expect(['cart']).toContain(orderRow?.statut);

  await cleanupStripePI(setup.paymentIntentId, 'required-success');
  await cleanupSetup(setup);
});

test('3DS required Visa (4000 0000 0000 3220) → requires_action + next_action structuré', async ({
  page,
  ctx,
}) => {
  test.setTimeout(120_000);
  const setup = await setupOrderWithPaymentIntent(page, ctx, 'required-visa');

  const confirmed = await confirmWith3DSCard({
    paymentIntentId: setup.paymentIntentId,
    cardNumber: '4000000000003220',
  });

  expect(confirmed.status, `PI status required-visa: ${confirmed.status}`).toBe(
    'requires_action',
  );
  expect(confirmed.next_action).toBeTruthy();
  expect(['use_stripe_sdk', 'redirect_to_url']).toContain(confirmed.next_action!.type);

  await cleanupStripePI(setup.paymentIntentId, 'required-visa');
  await cleanupSetup(setup);
});

// 3DS required + DECLINED post-challenge : non testé E2E.
//
// Justification :
//   - La carte 4000 0082 6000 3178 produit `requires_action` au confirm
//     (challenge proposé), puis le PI repasse à `requires_payment_method`
//     UNIQUEMENT si le user clique "Fail Test Payment" dans l'iframe
//     `hooks.stripe.com/3d_secure_2/...`.
//   - Driver cette iframe via Playwright headless n'est pas stable : sélecteurs
//     DOM Stripe non documentés, race conditions sur le load de l'iframe,
//     anti-bot sur le subdomain hooks.stripe.com (idem smoke-phase3 sur
//     Connect onboard, cf. PIVOT documenté ligne 105-114 de ce spec).
//   - Couverture indirecte côté unitaire : tests/lib/stripe/handle-payment-
//     failed.test.ts couvre déjà la transition order → cancelled+payment_failed
//     sur réception d'un webhook payment_intent.payment_failed (qui est
//     justement l'event émis par Stripe quand le 3DS challenge échoue).
//
// Si ce test devient critique pour go-live, alternative : drive en mode
// `--headed` + sélecteur stable sur le bouton "Fail Test Payment" (texte
// constant). Laissé hors scope phase B — mention explicite dans le doc fix.
test.skip('3DS required + DECLINED post-challenge (4000 0082 6000 3178) — drive UI hors scope E2E stable', () => {
  // intentionally empty — voir doc justification ci-dessus
});
