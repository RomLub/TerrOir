/**
 * E2E RLS isolation test — valide que le refacto SSR Phase 3 (commit 58c7436)
 * de /(producer)/commandes, /(producer)/catalogue et /(consumer)/compte/commandes
 * ne leak pas les données entre tenants.
 *
 * Risque #1 du refacto : ces pages sont passées d'un client browser (RLS
 * naturelle via auth.uid()) à un admin client serveur + filter explicite
 * .eq('producer_id', producer.id) ou .eq('consumer_id', session.id). Un bug
 * silencieux (mauvais id, filter oublié, fetchProducerForUser qui retourne le
 * mauvais producer) permettrait à un tenant de voir les données d'un autre.
 *
 * Couverture :
 *  - Producer A login → /commandes voit ses commandes uniquement (pas celles
 *    de B). Idem pour B après clearCookies + login.
 *  - Producer A login → /catalogue voit ses produits uniquement.
 *  - Consumer C login → /compte/commandes voit ses commandes uniquement.
 *
 * Cleanup : les producers sont créés HORS try (afterEach les delete via cascade
 * users → producers → products/slots). Mais orders.producer_id NO ACTION : si
 * on laisse des orders, le delete producer fail → auth.admin.deleteUser fail
 * → user résiduel en prod-DB. Donc createTestOrder + assertions sont DANS le
 * try, et cleanupOrdersForProducers tourne dans finally → cleanup des orders
 * même si createTestOrder ou les assertions throw.
 */

import { test, expect } from './helpers/test-context';
import { createTestProducer } from './helpers/producer-lifecycle';
import { createTestUser, loginAs } from './helpers/user-lifecycle';
import {
  createTestOrder,
  cleanupOrdersForProducers,
} from './helpers/order-lifecycle';

test('RLS isolation — Producer A ne voit PAS les commandes de Producer B sur /commandes', async ({
  page,
  ctx,
}) => {
  test.setTimeout(90_000);

  const producerA = await createTestProducer(ctx, {
    suffix: 'rls-prod-a',
    statut: 'public',
  });
  const producerB = await createTestProducer(ctx, {
    suffix: 'rls-prod-b',
    statut: 'public',
  });
  const consumer = await createTestUser(ctx, { suffix: 'rls-cons' });

  try {
    const orderA = await createTestOrder(ctx, {
      producerId: producerA.producerId,
      consumerId: consumer.id,
      codeCommande: `RLSPA-${Date.now()}-A`,
    });
    const orderB = await createTestOrder(ctx, {
      producerId: producerB.producerId,
      consumerId: consumer.id,
      codeCommande: `RLSPB-${Date.now()}-B`,
    });

    console.log(
      `[rls-iso] orderA.code=${orderA.codeCommande} (producer=${producerA.producerId})`,
    );
    console.log(
      `[rls-iso] orderB.code=${orderB.codeCommande} (producer=${producerB.producerId})`,
    );

    // ── Étape 1 — Producer A voit SA commande, pas celle de B ──
    await loginAs(page, producerA.user);
    await page.goto('/commandes');
    await expect(page.getByRole('heading', { name: 'Vos commandes' })).toBeVisible();

    await expect(
      page.getByText(orderA.codeCommande, { exact: false }),
      `Producer A devrait voir SA commande ${orderA.codeCommande}`,
    ).toBeVisible();
    await expect(
      page.getByText(orderB.codeCommande, { exact: false }),
      `LEAK: Producer A ne devrait PAS voir la commande ${orderB.codeCommande} de Producer B`,
    ).toHaveCount(0);

    // ── Étape 2 — Producer B voit SA commande, pas celle de A ──
    await page.context().clearCookies();
    await loginAs(page, producerB.user);
    await page.goto('/commandes');
    await expect(page.getByRole('heading', { name: 'Vos commandes' })).toBeVisible();

    await expect(
      page.getByText(orderB.codeCommande, { exact: false }),
      `Producer B devrait voir SA commande ${orderB.codeCommande}`,
    ).toBeVisible();
    await expect(
      page.getByText(orderA.codeCommande, { exact: false }),
      `LEAK: Producer B ne devrait PAS voir la commande ${orderA.codeCommande} de Producer A`,
    ).toHaveCount(0);
  } finally {
    await cleanupOrdersForProducers([
      producerA.producerId,
      producerB.producerId,
    ]);
  }
});

test('RLS isolation — Producer A ne voit PAS les produits de Producer B sur /catalogue', async ({
  page,
  ctx,
}) => {
  test.setTimeout(90_000);

  const producerA = await createTestProducer(ctx, {
    suffix: 'rls-cat-a',
    statut: 'public',
  });
  const producerB = await createTestProducer(ctx, {
    suffix: 'rls-cat-b',
    statut: 'public',
  });
  const consumer = await createTestUser(ctx, { suffix: 'rls-cat-cons' });

  try {
    const ts = Date.now();
    const productNomA = `PRODUCTRLSA-${ts}`;
    const productNomB = `PRODUCTRLSB-${ts}`;

    // createTestOrder crée aussi un product (nom = options.productNom).
    // On l'utilise comme marqueur visible sur /catalogue.
    const orderA = await createTestOrder(ctx, {
      producerId: producerA.producerId,
      consumerId: consumer.id,
      productNom: productNomA,
    });
    const orderB = await createTestOrder(ctx, {
      producerId: producerB.producerId,
      consumerId: consumer.id,
      productNom: productNomB,
    });

    console.log(`[rls-iso] productA=${productNomA} productB=${productNomB}`);
    console.log(`[rls-iso] orderA=${orderA.orderId} orderB=${orderB.orderId}`);

    await loginAs(page, producerA.user);
    await page.goto('/catalogue');
    await expect(page.getByRole('heading', { name: 'Vos produits' })).toBeVisible();

    await expect(
      page.getByRole('heading', { name: productNomA }),
      `Producer A devrait voir SON produit ${productNomA}`,
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: productNomB }),
      `LEAK: Producer A ne devrait PAS voir le produit ${productNomB} de Producer B`,
    ).toHaveCount(0);
  } finally {
    await cleanupOrdersForProducers([
      producerA.producerId,
      producerB.producerId,
    ]);
  }
});

test('RLS isolation — Consumer C ne voit PAS les commandes de Consumer D sur /compte/commandes', async ({
  page,
  ctx,
}) => {
  test.setTimeout(90_000);

  const producer = await createTestProducer(ctx, {
    suffix: 'rls-cons-prod',
    statut: 'public',
  });
  const consumerC = await createTestUser(ctx, { suffix: 'rls-cons-c' });
  const consumerD = await createTestUser(ctx, { suffix: 'rls-cons-d' });

  try {
    // daysAhead différent : la table slots a un unique constraint (producer_id,
    // starts_at). Comme orderC et orderD partagent le même producer, leurs slots
    // doivent avoir des starts_at distincts.
    const orderC = await createTestOrder(ctx, {
      producerId: producer.producerId,
      consumerId: consumerC.id,
      codeCommande: `RLSC-${Date.now()}-C`,
      daysAhead: 1,
    });
    const orderD = await createTestOrder(ctx, {
      producerId: producer.producerId,
      consumerId: consumerD.id,
      codeCommande: `RLSD-${Date.now()}-D`,
      daysAhead: 2,
    });

    console.log(
      `[rls-iso] orderC.code=${orderC.codeCommande} (consumer=${consumerC.id})`,
    );
    console.log(
      `[rls-iso] orderD.code=${orderD.codeCommande} (consumer=${consumerD.id})`,
    );

    // ── Étape 1 — Consumer C voit SA commande, pas celle de D ──
    await loginAs(page, consumerC);
    await page.goto('/compte/commandes');
    await expect(page.getByRole('heading', { name: 'Mes commandes' })).toBeVisible();

    await expect(
      page.getByText(orderC.codeCommande, { exact: false }),
      `Consumer C devrait voir SA commande ${orderC.codeCommande}`,
    ).toBeVisible();
    await expect(
      page.getByText(orderD.codeCommande, { exact: false }),
      `LEAK: Consumer C ne devrait PAS voir la commande ${orderD.codeCommande} de Consumer D`,
    ).toHaveCount(0);

    // ── Étape 2 — Consumer D voit SA commande, pas celle de C ──
    await page.context().clearCookies();
    await loginAs(page, consumerD);
    await page.goto('/compte/commandes');
    await expect(page.getByRole('heading', { name: 'Mes commandes' })).toBeVisible();

    await expect(
      page.getByText(orderD.codeCommande, { exact: false }),
      `Consumer D devrait voir SA commande ${orderD.codeCommande}`,
    ).toBeVisible();
    await expect(
      page.getByText(orderC.codeCommande, { exact: false }),
      `LEAK: Consumer D ne devrait PAS voir la commande ${orderC.codeCommande} de Consumer C`,
    ).toHaveCount(0);
  } finally {
    await cleanupOrdersForProducers([producer.producerId]);
  }
});
