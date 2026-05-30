/**
 * Audit Stripe phase B (2026-05-05) Session H — decline E2E user-side.
 *
 * Couvre le flow de décliné simple via carte test 4000 0000 0000 0002
 * (`generic_decline`, pas de challenge 3DS). Complément à la matrice 3DS
 * `stripe-3ds-matrix.spec.ts` qui couvre uniquement les cas success
 * frictionless / requires_action. Ici on valide la chaîne :
 *   carte refusée → Stripe error → classifyStripeError UI → page erreur
 *   compréhensible (fallback locale FR ou message Stripe natif fr).
 *
 * Approche pragmatique — 2 niveaux de validation :
 *
 *  1. API-level (`Decline server-side + webhook synthétique`) :
 *     - Confirm le PaymentIntent côté serveur avec carte 4000 0000 0000 0002
 *       (pattern stripe-3ds-matrix Step C). Stripe retourne un statut PI
 *       `requires_payment_method` + last_payment_error.code='card_declined'.
 *     - Push un webhook synthétique signé `payment_intent.payment_failed`
 *       sur /api/stripe/webhook → vérifie que `syncStripePaymentFailed`
 *       transite l'order pending → cancelled + closure_reason='payment_failed'.
 *     - Couvre : Stripe SDK decline behavior + handle-payment-failed handler
 *       chain + audit log forensique.
 *
 *  2. UI-level (`Drive Stripe Element`) :
 *     - Cart hydration via localStorage (zustand persist 'terroir_cart').
 *     - Navigation /compte/checkout, attente du PaymentElement monté.
 *     - Saisie raw dans l'iframe Stripe Elements (frame-locator par
 *       title FR 'Champ de saisie sécurisé pour le paiement').
 *     - Submit → assertion error message FR affiché côté UI.
 *
 *     Drive iframe est documenté instable (cf. stripe-3ds-matrix.spec.ts
 *     ligne 19-26 sur l'anti-bot Stripe + sélecteurs DOM non documentés).
 *     Si headless échoue, fallback `npm run test:e2e:headed -- --grep
 *     "decline UI"` documenté dans le doc fix.
 *
 * Cleanup :
 *  - Stripe : refunds.create si PI confirmé succeeded ; cancel si encore
 *    requires_*. Idempotency key par scenario (cf. stripe-idempotency.md).
 *  - DB : order_items / orders / products / slots / consumer purgés via
 *    cleanupAllTrackedUsers (afterEach test-context).
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

// Carte test Stripe : decline générique sans challenge 3DS. Émet
// last_payment_error.code='card_declined' + decline_code='generic_decline'.
// Cf. https://docs.stripe.com/testing#declined-payments-failures.
const DECLINED_CARD_NUMBER = '4000000000000002';
// Carte test "happy" pour le retry après decline (3DS bypass auto en test).
const SUCCESS_CARD_NUMBER = '4242424242424242';

test.beforeAll(() => {
  const key = process.env.STRIPE_SECRET_KEY ?? '';
  if (!key.startsWith('sk_test_')) {
    throw new Error(
      `STRIPE_SECRET_KEY n'est pas une clé test (prefix=${key.slice(0, 8)}). ` +
        `Ce spec confirme des PI raw card → refus en LIVE.`,
    );
  }
});

// =============================================================================
// Helpers locaux
// =============================================================================

interface SetupResult {
  producerId: string;
  consumer: TestUser;
  productId: string;
  productNom: string;
  productPrix: number;
  productUnite: string;
  producerSlug: string;
  slotId: string;
  dateRetrait: string;
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
    suffix: `decline-${scenarioSuffix}`,
    statut: 'public',
  });

  // Active les flags Stripe Connect côté DB (équivalent post-onboarding KYC) —
  // bypass du guard M-6 charges_enabled dans /api/stripe/create-payment-intent.
  await admin
    .from('producers')
    .update({
      stripe_charges_enabled: true,
      stripe_payouts_enabled: true,
      stripe_details_submitted: true,
    })
    .eq('id', producer.producerId);

  const productNom = `Decline Test Product (${scenarioSuffix})`;
  const productPrix = 12.5;
  const productUnite = 'piece';

  const { data: product } = await admin
    .from('products')
    .insert({
      producer_id: producer.producerId,
      nom: productNom,
      description: `Produit créé par stripe-decline (${scenarioSuffix})`,
      prix: productPrix,
      unite: productUnite,
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

  const consumer = await createTestUser(ctx, {
    suffix: `decline-cons-${scenarioSuffix}`,
  });
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
    productNom,
    productPrix,
    productUnite,
    producerSlug: producer.slug,
    slotId: slot!.id as string,
    dateRetrait,
    orderId,
    paymentIntentId,
    clientSecret: client_secret,
  };
}

interface ConfirmWithCardOptions {
  paymentIntentId: string;
  cardNumber: string;
  cvc?: string;
  expMonth?: number;
  expYear?: number;
  returnUrl?: string;
}

async function confirmWithCard(
  options: ConfirmWithCardOptions,
): Promise<Stripe.PaymentIntent> {
  const paymentMethod = await stripe.paymentMethods.create({
    type: 'card',
    card: {
      number: options.cardNumber,
      exp_month: options.expMonth ?? 12,
      exp_year: options.expYear ?? new Date().getFullYear() + 4,
      cvc: options.cvc ?? '123',
    },
  });
  return stripe.paymentIntents.confirm(options.paymentIntentId, {
    payment_method: paymentMethod.id,
    return_url: options.returnUrl ?? 'https://example.com/decline-callback',
  });
}

function makeSignedWebhookPost(eventObject: {
  id: string;
  type: string;
  data: { object: unknown };
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
  await admin.from('order_items').delete().eq('order_id', setup.orderId);
  await admin.from('orders').delete().eq('id', setup.orderId);
  await admin.from('products').delete().eq('id', setup.productId);
  await admin.from('slots').delete().eq('id', setup.slotId);
}

async function cleanupStripePI(
  paymentIntentId: string,
  scenario: string,
): Promise<void> {
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.status === 'succeeded') {
      await stripe.refunds.create(
        { payment_intent: paymentIntentId },
        { idempotencyKey: `refund_${paymentIntentId}_decline_${scenario}` },
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
      `[decline-${scenario}] cleanup PI ${paymentIntentId} failed: ` +
        `${(err as Error).message} — non bloquant`,
    );
  }
}

// =============================================================================
// Tests
// =============================================================================

test('Decline API + webhook (4000 0000 0000 0002) → order cancelled+payment_failed', async ({
  page,
  ctx,
}) => {
  test.setTimeout(120_000);
  const setup = await setupOrderWithPaymentIntent(page, ctx, 'api');

  // 1. Confirm server-side avec carte declined.
  //    Stripe SDK throw StripeCardError au confirm direct (vs success cards qui
  //    retournent le PI inline). On catch pour récupérer l'erreur structurée.
  let stripeErrorCode: string | undefined;
  let stripeDeclineCode: string | undefined;
  try {
    await confirmWithCard({
      paymentIntentId: setup.paymentIntentId,
      cardNumber: DECLINED_CARD_NUMBER,
    });
    throw new Error('confirmWithCard should have thrown StripeCardError');
  } catch (err) {
    if (err instanceof Stripe.errors.StripeCardError) {
      stripeErrorCode = err.code;
      stripeDeclineCode = err.decline_code;
    } else {
      throw err;
    }
  }
  expect(stripeErrorCode, 'Stripe error code expected').toBe('card_declined');
  expect(stripeDeclineCode, 'Stripe decline_code expected').toBe('generic_decline');

  // 2. Vérifie le statut PI Stripe : requires_payment_method (decline ne
  //    cancel pas le PI, il le repasse en attente d'une autre méthode).
  const piAfter = await stripe.paymentIntents.retrieve(setup.paymentIntentId);
  expect(piAfter.status).toBe('requires_payment_method');
  expect(piAfter.last_payment_error?.code).toBe('card_declined');

  // 3. Sans webhook réel (STRIPE_WEBHOOK_SECRET=placeholder en local), on
  //    construit + signe un payment_intent.payment_failed synthétique pour
  //    valider la chaîne handle-payment-failed → order DB transition.
  const { payload, signature } = makeSignedWebhookPost({
    id: `evt_decline_${Date.now()}`,
    type: 'payment_intent.payment_failed',
    data: { object: piAfter as unknown as Record<string, unknown> },
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
    `webhook payment_intent.payment_failed: ${await webhookResponse.text()}`,
  ).toBe(200);

  // 4. Vérifie que l'order a transité pending → cancelled + closure_reason
  //    (cf. lib/stripe/handle-payment-failed.ts).
  const admin = getRawAdminClient();
  const { data: orderRow } = await admin
    .from('orders')
    .select('statut, closure_reason, cancelled_at')
    .eq('id', setup.orderId)
    .single();
  expect(orderRow?.statut).toBe('cancelled');
  expect(orderRow?.closure_reason).toBe('payment_failed');
  expect(orderRow?.cancelled_at).toBeTruthy();

  await cleanupStripePI(setup.paymentIntentId, 'api');
  await cleanupSetup(setup);
});

test('Decline UI (4000 0000 0000 0002) → page erreur compréhensible affichée', async ({
  page,
  ctx,
}) => {
  test.setTimeout(180_000);

  // Setup minimal : on ne pré-crée PAS l'order/PI ici, le checkout les crée
  // côté client via /api/orders/create + /api/stripe/create-payment-intent
  // au mount. On hydrate juste le panier zustand pour que /compte/checkout
  // ait un group à traiter.
  const admin = getRawAdminClient();

  const producer = await createTestProducer(ctx, {
    suffix: 'decline-ui',
    statut: 'public',
  });
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
      nom: 'Decline UI Test Product',
      description: 'Produit créé par stripe-decline (ui)',
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

  const consumer = await createTestUser(ctx, { suffix: 'decline-ui-cons' });
  await page.context().clearCookies();
  await loginAs(page, consumer);

  // Hydrate panier zustand côté localStorage (clé persist 'terroir_cart').
  // Charge d'abord une page same-origin pour que window.localStorage soit
  // accessible (about:blank n'expose pas localStorage).
  await page.goto('/');
  const dateRetrait = tomorrow.toISOString().slice(0, 10);
  const cartItem = {
    productId: product!.id as string,
    producerId: producer.producerId,
    slug: producer.slug,
    nom: 'Decline UI Test Product',
    prix: 12.5,
    unite: 'piece',
    quantite: 1,
    creneauId: slot!.id as string,
    dateRetrait,
    producerName: 'Test Producer',
  };
  await page.evaluate((item) => {
    window.localStorage.setItem(
      'terroir_cart',
      JSON.stringify({ state: { items: [item] }, version: 1 }),
    );
  }, cartItem);

  // Navigation checkout. Le useEffect mount va (1) cart/validate (2) orders/
  // create (3) stripe/create-payment-intent → setClientSecret. PaymentElement
  // monte ensuite via <Elements stripe options={{clientSecret}}>.
  const groupId = `${cartItem.producerId}|${cartItem.creneauId}|${cartItem.dateRetrait}`;
  await page.goto(`/compte/checkout?group=${encodeURIComponent(groupId)}`);

  // Attendre que le bouton "Payer X €" soit visible (signal que clientSecret
  // est posé + PaymentElement monté). Timeout généreux : Stripe.js charge
  // depuis js.stripe.com et le PaymentElement init est async.
  const payButton = page.getByRole('button', { name: /Payer\s+12,50\s*€/i });
  await expect(payButton).toBeVisible({ timeout: 30_000 });

  // Drive iframe Stripe PaymentElement. Le PaymentElement v2 utilise un
  // iframe par champ visible (number, expiry, cvc). On utilise frame-locator
  // par title FR (locale 'fr' configurée sur Elements). Si le headless échoue
  // à driver l'iframe (anti-bot Stripe sur Chromium headless), fallback :
  //   npm run test:e2e:headed -- --grep "Decline UI"
  //
  // Note : Stripe utilise des iframes séparés pour chaque champ depuis la
  // refonte Elements 2024. Sélecteurs par title (i18n FR) :
  //   - "Numéro de carte"        → input[name="number"]
  //   - "Date d'expiration"      → input[name="expiry"]
  //   - "Code de sécurité"       → input[name="cvc"]
  //   - "Code postal"            → input[name="postalCode"] (rare en FR)
  const cardNumberFrame = page.frameLocator(
    'iframe[title="Champ de saisie sécurisé pour le paiement"]',
  ).first();
  await cardNumberFrame
    .locator('input[name="number"]')
    .fill(DECLINED_CARD_NUMBER, { timeout: 15_000 });

  // L'iframe expiry/cvc peut être le même (PaymentElement single-iframe) ou
  // distinct selon la version Stripe. On tente les locators dans le même frame
  // d'abord, puis fallback sur les autres iframes du title.
  const allStripeFrames = page.locator(
    'iframe[title="Champ de saisie sécurisé pour le paiement"]',
  );
  const frameCount = await allStripeFrames.count();

  let expiryFilled = false;
  let cvcFilled = false;
  for (let i = 0; i < frameCount; i++) {
    const frame = page.frameLocator(
      'iframe[title="Champ de saisie sécurisé pour le paiement"]',
    ).nth(i);
    if (!expiryFilled) {
      const expiryInput = frame.locator('input[name="expiry"]');
      if (await expiryInput.count().catch(() => 0)) {
        await expiryInput.fill('12/34').catch(() => {});
        expiryFilled = true;
      }
    }
    if (!cvcFilled) {
      const cvcInput = frame.locator('input[name="cvc"]');
      if (await cvcInput.count().catch(() => 0)) {
        await cvcInput.fill('123').catch(() => {});
        cvcFilled = true;
      }
    }
  }

  // Submit. Si le iframe drive a partiellement fail, le bouton reste enabled
  // mais Stripe retournera une error "incomplete" — gérée par classifyStripeError
  // avec code 'incomplete_*' (fallback generic message). On veut ici le case
  // 'card_declined' précis, donc on assert que les 3 champs sont OK avant.
  expect(expiryFilled, 'expiry input rempli').toBe(true);
  expect(cvcFilled, 'cvc input rempli').toBe(true);

  await payButton.click();

  // Attendre l'affichage du message d'erreur. classifyStripeError mappe
  // card_declined → message Stripe natif (locale 'fr') ou fallback FR
  // 'Paiement refusé. Essayez une autre carte.'. On accepte les deux.
  const errorBlock = page.locator(
    '.bg-terra-100\\/60.border.border-terra-300\\/40',
  );
  await expect(errorBlock).toContainText(/refus[ée]/i, { timeout: 30_000 });

  // L'order côté DB reste 'pending' (pas de webhook réel délivré en local).
  // Récupérer l'orderId via /api/orders/list ou via le PI. Plus simple :
  // query orders.consumer_id=consumer.id (1 seul order pour ce consumer
  // fresh).
  const { data: orderRows } = await admin
    .from('orders')
    .select('id, statut, stripe_payment_intent_id')
    .eq('consumer_id', consumer.id)
    .order('created_at', { ascending: false })
    .limit(1);
  expect(orderRows?.length).toBe(1);
  const orderRow = orderRows![0];
  expect(orderRow.statut, 'order reste pending sans webhook').toBe('pending');

  // Cleanup PI Stripe (cancel — il est en requires_payment_method post-decline).
  if (orderRow.stripe_payment_intent_id) {
    await cleanupStripePI(orderRow.stripe_payment_intent_id as string, 'ui');
  }
  // Cleanup DB rows.
  await admin.from('order_items').delete().eq('order_id', orderRow.id);
  await admin.from('orders').delete().eq('id', orderRow.id);
  await admin.from('products').delete().eq('id', product!.id as string);
  await admin.from('slots').delete().eq('id', slot!.id as string);
});

// Retry après decline : couvert par retry direct sur le même PI avec une
// nouvelle PaymentMethod (cf. classifyStripeError kind='card_declined' →
// retry direct OK). Pas testé E2E ici car :
//   - Le drive UI iframe est déjà la partie fragile du test ci-dessus —
//     enchaîner une 2e saisie alourdit la flakiness sans découvrir un bug
//     non couvert par le 1er test (le 1er valide déjà la classifyStripeError
//     + l'absence de transition DB).
//   - Le cas success post-retry est couvert par stripe-3ds-matrix.spec.ts
//     (4000 0084 0000 1629 frictionless → succeeded).
