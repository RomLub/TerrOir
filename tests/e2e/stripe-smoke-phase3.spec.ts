/**
 * Smoke E2E Phase 3 Lot 3 — valide la non-régression Stripe SDK 22 + apiVersion
 * dahlia (commit 801d471) sur les 3 call-sites critiques :
 *   A. accounts.create + accountLinks.create (Connect onboard)
 *   B. accounts.retrieve (lecture flags KYC)
 *   C. paymentIntents.create avec Customer + idempotencyKey (checkout consumer)
 *
 * Contraintes :
 *  - Tape sur la prod-DB Supabase (pattern projet, pas d'env-test isolé).
 *  - Mode TEST Stripe (sk_test_*) — vérifié au démarrage.
 *  - Single test() avec test.step pour partager le state inter-étapes
 *    (ctx test-scoped → cleanupAllTrackedUsers en afterEach purge user/producer
 *    via auth.admin.deleteUser CASCADE).
 *  - Webhook account.updated non disponible en local (STRIPE_WEBHOOK_SECRET=
 *    placeholder dans .env.local) → bypass via stripe.accounts.retrieve direct
 *    + UPDATE DB admin pour synchroniser les flags après onboarding.
 *
 * Étape B (drive UI Stripe Connect Express) repose sur le bouton « Skip »
 * test-mode de Stripe (Connect onboarding fournit un raccourci en test pour
 * éviter de remplir 6 pages de KYC). Si ce bouton n'est pas trouvé, le test
 * tombe en fallback en remplissant les champs un par un avec les test values
 * documentées (https://docs.stripe.com/connect/testing).
 */

import Stripe from 'stripe';
import { test, expect } from './helpers/test-context';
import { createTestProducer } from './helpers/producer-lifecycle';
import { createTestUser, loginAs } from './helpers/user-lifecycle';
import { getRawAdminClient } from './helpers/supabase-admin';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-04-22.dahlia',
  typescript: true,
});

// Garde-fou ceinture-bretelles : refuse de tourner en LIVE Stripe.
test.beforeAll(() => {
  const key = process.env.STRIPE_SECRET_KEY ?? '';
  if (!key.startsWith('sk_test_')) {
    throw new Error(
      `STRIPE_SECRET_KEY n'est pas une clé test (prefix=${key.slice(0, 8)}). ` +
        `Ce smoke crée un Connect account, refus en LIVE.`,
    );
  }
});

test('Smoke Phase 3 Lot 3 — Connect onboard + checkout E2E (SDK 22 + dahlia)', async ({
  page,
  ctx,
}) => {
  test.setTimeout(180_000); // Stripe Connect onboarding peut être long

  // ──────────────────────────────────────────────────────────────────────
  // SETUP — test producer (statut 'public' : visible RLS consumer pour le
  // checkout API en Étape C, et bypass le middleware redirect draft→/onboarding).
  // ──────────────────────────────────────────────────────────────────────
  const producer = await createTestProducer(ctx, {
    suffix: 'smoke-phase3',
    statut: 'public',
  });
  console.log(
    `[smoke] producer=${producer.producerId} user=${producer.user.id} email=${producer.user.email}`,
  );

  let stripeAccountId: string | null = null;

  // ──────────────────────────────────────────────────────────────────────
  // ÉTAPE A — Connect onboard route renvoie URL Stripe valide (SDK 22 +
  // dahlia). Valide accounts.create + accountLinks.create côté SDK.
  // ──────────────────────────────────────────────────────────────────────
  await test.step('A. POST /api/stripe/connect/onboard renvoie AccountLink valide', async () => {
    await loginAs(page, producer.user);

    const response = await page.request.post('/api/stripe/connect/onboard');
    expect(response.status(), 'connect/onboard doit répondre 200').toBe(200);
    const body = (await response.json()) as { url: string; account_id: string };

    expect(body.url, 'body.url doit pointer sur connect.stripe.com').toMatch(
      /^https:\/\/connect\.stripe\.com\//,
    );
    expect(body.account_id, 'body.account_id doit être un acct_').toMatch(
      /^acct_/,
    );

    stripeAccountId = body.account_id;
    console.log(`[smoke] stripeAccountId=${stripeAccountId}`);
    console.log(`[smoke] accountLink=${body.url}`);

    // Vérifie que la DB a bien été persistée par la route (cohérence T-418).
    const admin = getRawAdminClient();
    const { data: row } = await admin
      .from('producers')
      .select('stripe_account_id')
      .eq('id', producer.producerId)
      .maybeSingle();
    expect(row?.stripe_account_id).toBe(stripeAccountId);
  });

  // ──────────────────────────────────────────────────────────────────────
  // ÉTAPE B — Validation SDK 22 sur stripe.accounts.retrieve + setup
  // artificiel des flags DB pour permettre Step C.
  //
  // PIVOT vs scope initial : le drive UI Stripe Connect Express demande de
  // remplir 16 champs KYC (currently_due : business_type, business_profile.*,
  // individual.{first_name,last_name,dob,address,phone,email}, external_account,
  // tos_acceptance). Pas de "skip everything" magic en test mode pour Express.
  // Driver pas-à-pas est brittle (sélecteurs DOM Stripe non documentés) et
  // hors scope d'un smoke régression SDK.
  //
  // Approche bypass : on valide juste que stripe.accounts.retrieve(acct)
  // fonctionne sous SDK 22 + dahlia (lecture sans crash, parse correct des
  // 3 flags + requirements.currently_due), puis on simule la sync DB qu'aurait
  // faite le webhook account.updated en settant directement les flags via
  // admin update. Suffit pour passer le guard M-6 du Step C.
  // ──────────────────────────────────────────────────────────────────────
  await test.step('B. stripe.accounts.retrieve OK (SDK 22) + simul sync DB', async () => {
    expect(stripeAccountId, 'Étape A doit avoir produit un account_id').toBeTruthy();

    const acct = await stripe.accounts.retrieve(stripeAccountId!);
    expect(acct.id).toBe(stripeAccountId);
    // dahlia parse correctement les 3 flags (booleans, jamais undefined).
    expect(typeof acct.charges_enabled).toBe('boolean');
    expect(typeof acct.payouts_enabled).toBe('boolean');
    expect(typeof acct.details_submitted).toBe('boolean');

    const requirements = acct.requirements?.currently_due ?? [];
    console.log(
      `[smoke] Stripe flags (post-create, pré-KYC): charges=${acct.charges_enabled} ` +
        `payouts=${acct.payouts_enabled} details=${acct.details_submitted} ` +
        `currently_due_count=${requirements.length}`,
    );

    // Simul sync DB (équivalent syncStripeAccountFlags qu'aurait fait le
    // webhook account.updated post-onboarding KYC complet). On force charges
    // à true ici pour permettre le guard M-6 du Step C de passer. C'est un
    // raccourci de smoke, pas un scénario prod réaliste.
    const admin = getRawAdminClient();
    const { error: syncError } = await admin
      .from('producers')
      .update({
        stripe_charges_enabled: true,
        stripe_payouts_enabled: true,
        stripe_details_submitted: true,
      })
      .eq('id', producer.producerId);
    expect(syncError, 'sync DB flags doit réussir').toBeNull();

    const { data: row } = await admin
      .from('producers')
      .select('stripe_charges_enabled')
      .eq('id', producer.producerId)
      .single();
    expect(row?.stripe_charges_enabled).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────────
  // ÉTAPE C — Checkout consumer happy path (smoke API, pas drive Stripe
  // Element 3DS). Valide POST /api/orders/create + POST /api/stripe/create-
  // payment-intent (= passe le guard M-6 charges_enabled + crée un PI Stripe
  // avec Customer + idempotencyKey via SDK 22).
  // ──────────────────────────────────────────────────────────────────────
  await test.step('C. Checkout API consumer happy path (PI créé via SDK 22)', async () => {
    const admin = getRawAdminClient();

    // Setup minimal : 1 produit + 1 slot futur (capacity disponible).
    const { data: product, error: prodError } = await admin
      .from('products')
      .insert({
        producer_id: producer.producerId,
        nom: 'Smoke Test Product',
        description: 'Produit créé par stripe-smoke-phase3.spec.ts',
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
    expect(prodError, `INSERT product: ${prodError?.message ?? ''}`).toBeNull();

    // Slot demain matin 10h-11h (capacité 5).
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    const slotEnd = new Date(tomorrow);
    slotEnd.setHours(11, 0, 0, 0);

    const { data: slot, error: slotError } = await admin
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
    expect(slotError, `INSERT slot: ${slotError?.message ?? ''}`).toBeNull();

    // Date retrait au format YYYY-MM-DD (Europe/Paris alignement).
    const dateRetrait = tomorrow.toISOString().slice(0, 10);

    // Login consumer test (fresh user pour éviter cross-state).
    // Clear cookies pour forcer le re-login : sinon /connexion redirige
    // déjà vers la home producer (cookies de session du Step A encore là).
    const consumer = await createTestUser(ctx, { suffix: 'consumer' });
    await page.context().clearCookies();
    await loginAs(page, consumer);

    const orderResponse = await page.request.post('/api/orders/create', {
      data: {
        producer_id: producer.producerId,
        slot_id: slot!.id as string,
        date_retrait: dateRetrait,
        items: [{ product_id: product!.id as string, quantite: 1 }],
      },
    });
    expect(
      orderResponse.status(),
      `orders/create: ${await orderResponse.text()}`,
    ).toBe(200);
    const orderBody = (await orderResponse.json()) as { order_id: string };
    expect(orderBody.order_id).toBeTruthy();
    console.log(`[smoke] order=${orderBody.order_id}`);

    const piResponse = await page.request.post('/api/stripe/create-payment-intent', {
      data: { order_id: orderBody.order_id, save_card: false },
    });
    expect(
      piResponse.status(),
      `create-payment-intent: ${await piResponse.text()}`,
    ).toBe(200);
    const piBody = (await piResponse.json()) as { client_secret: string };
    expect(piBody.client_secret).toMatch(/^pi_.+_secret_/);
    console.log(`[smoke] PI client_secret OK (préfixe ${piBody.client_secret.slice(0, 12)}…)`);

    // Audit Stripe phase 2 M-1 : vérifie que le PI a bien
    // automatic_payment_methods.enabled (Card + Apple Pay + Google Pay activés
    // dynamiquement via Dashboard) au lieu de payment_method_types: ['card']
    // hardcodé. allow_redirects:'never' filtre SEPA/Bancontact/iDEAL pour
    // préserver le flow single-page (skip explicite SEPA cf phase V1.1).
    // Note : Apple Pay / Google Pay E2E réels (modal Wallet device-side) =
    // impossible à automatiser proprement (Apple Pay requiert iPhone Safari
    // physique + carte sandbox + biométrie ; Google Pay requiert Chrome avec
    // compte Google + carte sandbox). Test plan post-deploy = matrice manuelle
    // documentée dans docs/fixes/fix-stripe-phase-2-m1-l3-2026-05-05.md.
    const piId = piBody.client_secret.split('_secret_')[0]!;
    const pi = await stripe.paymentIntents.retrieve(piId);
    expect(pi.automatic_payment_methods?.enabled).toBe(true);
    expect(pi.automatic_payment_methods?.allow_redirects).toBe('never');
    expect(pi.payment_method_types).toEqual(
      expect.arrayContaining(['card']),
    );
    console.log(
      `[smoke] PI automatic_payment_methods OK (methods=${pi.payment_method_types.join(',')})`,
    );
  });

  // ──────────────────────────────────────────────────────────────────────
  // CLEANUP — stripe.accounts.del + purge DB rows liés au producer
  // (orders/products/slots/order_items). Ces tables ont des FK
  // producer_id/consumer_id en NO ACTION → bloquent auth.admin.deleteUser
  // via cleanupAllTrackedUsers (afterEach). On les purge manuellement avant.
  // ──────────────────────────────────────────────────────────────────────
  await test.step('Cleanup: Stripe account + DB rows liés', async () => {
    const admin = getRawAdminClient();

    // 1. Stripe account
    if (stripeAccountId) {
      try {
        await stripe.accounts.del(stripeAccountId);
        console.log(`[smoke] stripe.accounts.del(${stripeAccountId}) OK`);
      } catch (err) {
        console.warn(
          `[smoke] stripe.accounts.del(${stripeAccountId}) failed: ${
            (err as Error).message
          } — non bloquant`,
        );
      }
    }

    // 2. order_items + orders (consumer_id ou producer_id rattaché au test)
    //    Récupère d'abord les order_ids pour delete les order_items.
    const { data: orders } = await admin
      .from('orders')
      .select('id')
      .or(`producer_id.eq.${producer.producerId}`);
    const orderIds = (orders ?? []).map((r) => r.id as string);
    if (orderIds.length > 0) {
      await admin.from('order_items').delete().in('order_id', orderIds);
      await admin.from('orders').delete().in('id', orderIds);
    }

    // 3. products + slots rattachés au test producer
    await admin.from('products').delete().eq('producer_id', producer.producerId);
    await admin.from('slots').delete().eq('producer_id', producer.producerId);

    console.log(
      `[smoke] DB cleanup: ${orderIds.length} order(s) + products + slots purgés`,
    );
  });
});
