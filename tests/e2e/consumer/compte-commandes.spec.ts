/**
 * E2E consumer/compte/commandes — listing + détail commande (Phase 3).
 *
 * Setup : seed user consumer + 1 producer + 3 orders (pending, confirmed,
 * completed) via seedOrder. Cleanup orders/products/slots via
 * cleanupOrdersForProducers en finally (NO ACTION sur producers.id).
 *
 * Couverture :
 *   - Listing /compte/commandes affiche les 3 orders
 *   - Filtrage par tabs (Toutes / En cours / Terminees / Annulees)
 *   - Détail [id] : code retrait visible si statut=confirmed
 *   - 404 silencieux : id inexistant => notFound() côté SSR
 *   - 403/redirect si commande d'un autre user (RLS user-client filtre,
 *     SSR utilise admin client + check applicatif consumer_id)
 *   - Coordonnées producer floutées (T-217 Cluster A : vue producers_public
 *     arrondit lat/lng à 2 décimales DB-level)
 */

import { test, expect } from '../helpers/test-context';
import {
  seedConsumer,
  seedProducer,
  seedOrder,
} from '../helpers/db-seed';
import { loginAs } from '../helpers/user-lifecycle';
import {
  cleanupOrdersForProducers,
} from '../helpers/order-lifecycle';
import { getReadOnlyAdminClient } from '../helpers/supabase-admin';

test.describe('Consumer — /compte/commandes', () => {
  test('liste les 3 orders (pending, confirmed, completed) du consumer', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(120_000);

    const consumer = await seedConsumer(ctx, { suffix: 'list' });
    const producer = await seedProducer(ctx, {
      suffix: 'list-prod',
      statut: 'public',
    });

    const orders = [];
    try {
      orders.push(
        await seedOrder(ctx, {
          producerId: producer.producerId,
          consumerId: consumer.id,
          codeCommande: `LIST-${Date.now()}-P`,
          statut: 'pending',
        }),
      );
      orders.push(
        await seedOrder(ctx, {
          producerId: producer.producerId,
          consumerId: consumer.id,
          codeCommande: `LIST-${Date.now()}-C`,
          statut: 'confirmed',
        }),
      );
      orders.push(
        await seedOrder(ctx, {
          producerId: producer.producerId,
          consumerId: consumer.id,
          codeCommande: `LIST-${Date.now()}-D`,
          statut: 'completed',
        }),
      );

      await loginAs(page, consumer);
      await page.goto('/compte/commandes');

      await expect(
        page.getByRole('heading', { name: 'Mes commandes', exact: true }),
      ).toBeVisible();

      for (const o of orders) {
        await expect(page.getByText(o.codeCommande, { exact: false })).toBeVisible();
      }
    } finally {
      await cleanupOrdersForProducers([producer.producerId]);
    }
  });

  test('filtrage par tabs : "En cours" cache la commande completed', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(120_000);

    const consumer = await seedConsumer(ctx, { suffix: 'filter' });
    const producer = await seedProducer(ctx, {
      suffix: 'filter-prod',
      statut: 'public',
    });

    try {
      const pending = await seedOrder(ctx, {
        producerId: producer.producerId,
        consumerId: consumer.id,
        codeCommande: `FLT-${Date.now()}-P`,
        statut: 'pending',
      });
      const completed = await seedOrder(ctx, {
        producerId: producer.producerId,
        consumerId: consumer.id,
        codeCommande: `FLT-${Date.now()}-D`,
        statut: 'completed',
      });

      await loginAs(page, consumer);
      await page.goto('/compte/commandes');

      // Tab "En cours" : pending visible, completed cachée
      await page.getByRole('button', { name: 'En cours', exact: true }).click();
      await expect(page.getByText(pending.codeCommande, { exact: false })).toBeVisible();
      await expect(page.getByText(completed.codeCommande, { exact: false })).toHaveCount(0);

      // Tab "Terminées" : inverse
      await page.getByRole('button', { name: 'Terminées', exact: true }).click();
      await expect(page.getByText(completed.codeCommande, { exact: false })).toBeVisible();
      await expect(page.getByText(pending.codeCommande, { exact: false })).toHaveCount(0);
    } finally {
      await cleanupOrdersForProducers([producer.producerId]);
    }
  });

  test('détail [id] : code retrait visible si statut=confirmed', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(120_000);

    const consumer = await seedConsumer(ctx, { suffix: 'detail' });
    const producer = await seedProducer(ctx, {
      suffix: 'detail-prod',
      statut: 'public',
    });

    try {
      const order = await seedOrder(ctx, {
        producerId: producer.producerId,
        consumerId: consumer.id,
        codeCommande: `DET-${Date.now()}-X`,
        statut: 'confirmed',
      });

      await loginAs(page, consumer);
      await page.goto(`/compte/commandes/${order.orderId}`);

      // Le code retrait apparaît côté UI (rendu via composant CodeCommande
      // quand statut=confirmed cf. OrderDetailClient: showCode = ...).
      await expect(page.getByText(order.codeCommande, { exact: false })).toBeVisible({
        timeout: 10_000,
      });
    } finally {
      await cleanupOrdersForProducers([producer.producerId]);
    }
  });

  test('détail [id] inexistant : notFound (404 page)', async ({ page, ctx }) => {
    test.setTimeout(60_000);

    const consumer = await seedConsumer(ctx, { suffix: 'nf' });
    await loginAs(page, consumer);

    // UUID syntactiquement valide mais inexistant en DB → notFound()
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const response = await page.goto(`/compte/commandes/${fakeId}`);
    expect(response?.status() ?? 0).toBe(404);
  });

  test('détail [id] d\'un autre user : redirect vers /compte/commandes', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(120_000);

    const consumerA = await seedConsumer(ctx, { suffix: 'rls-a' });
    const consumerB = await seedConsumer(ctx, { suffix: 'rls-b' });
    const producer = await seedProducer(ctx, {
      suffix: 'rls-prod',
      statut: 'public',
    });

    try {
      // Order appartient à consumer A
      const order = await seedOrder(ctx, {
        producerId: producer.producerId,
        consumerId: consumerA.id,
        codeCommande: `RLS-${Date.now()}-X`,
        statut: 'pending',
      });

      // Login en tant que B → tente d'accéder à l'order de A
      await loginAs(page, consumerB);
      await page.goto(`/compte/commandes/${order.orderId}`);

      // SSR fait redirect('/compte/commandes') si consumer_id !== session.id.
      await expect(page).toHaveURL(/\/compte\/commandes(?!\/)/, {
        timeout: 10_000,
      });
    } finally {
      await cleanupOrdersForProducers([producer.producerId]);
    }
  });

  test('coordonnées producer floutées (T-217) : 2 décimales max sur la page détail', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(120_000);

    const consumer = await seedConsumer(ctx, { suffix: 'coord' });
    const producer = await seedProducer(ctx, {
      suffix: 'coord-prod',
      statut: 'public',
    });

    // On pose des lat/lng pleins (4+ décimales) côté DB pour vérifier le
    // floutage downstream. Les writes lat/lng sur producers passent par
    // des admin updates (FORCE RLS bloque les self-updates sur ces colonnes
    // T-218-bis). Service role bypass ici pour le seed.
    const admin = getReadOnlyAdminClient();
    await admin
      .from('producers')
      .update({ latitude: 47.99876, longitude: 0.19876 })
      .eq('id', producer.producerId);

    try {
      const order = await seedOrder(ctx, {
        producerId: producer.producerId,
        consumerId: consumer.id,
        codeCommande: `CRD-${Date.now()}-X`,
        statut: 'confirmed',
      });

      await loginAs(page, consumer);
      await page.goto(`/compte/commandes/${order.orderId}`);

      // Vue producers_public arrondit lat/lng à 2 décimales DB-level.
      // On vérifie qu'aucune chaîne 4-décimales (.9876, .1987) ne fuite.
      const html = await page.content();
      expect(html).not.toMatch(/47\.9987/);
      expect(html).not.toMatch(/0\.1987/);
    } finally {
      await cleanupOrdersForProducers([producer.producerId]);
    }
  });
});
