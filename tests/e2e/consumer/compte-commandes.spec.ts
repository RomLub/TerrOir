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
      // codeCommande laissé vide : trigger Postgres generate_order_code()
      // pose un code TRR unique. Pas de collision sur slot car le helper
      // staggér starts_at via _slotSlotCounter.
      orders.push(
        await seedOrder(ctx, {
          producerId: producer.producerId,
          consumerId: consumer.id,
          statut: 'pending',
        }),
      );
      orders.push(
        await seedOrder(ctx, {
          producerId: producer.producerId,
          consumerId: consumer.id,
          statut: 'confirmed',
        }),
      );
      orders.push(
        await seedOrder(ctx, {
          producerId: producer.producerId,
          consumerId: consumer.id,
          statut: 'completed',
        }),
      );

      await loginAs(page, consumer);
      await page.goto('/compte/commandes');

      await expect(
        page.getByRole('heading', { name: 'Mes commandes', exact: true }),
      ).toBeVisible();

      for (const o of orders) {
        // Le code TRR peut apparaître dans plusieurs éléments
        // imbriqués (link role + span). .first() évite la strict mode
        // violation tout en validant la présence.
        await expect(
          page.getByText(o.codeCommande, { exact: false }).first(),
        ).toBeVisible();
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
        statut: 'pending',
      });
      const completed = await seedOrder(ctx, {
        producerId: producer.producerId,
        consumerId: consumer.id,
        statut: 'completed',
      });

      await loginAs(page, consumer);
      await page.goto('/compte/commandes');

      // Tab "En cours" : pending visible, completed cachée. Le code TRR
      // peut apparaître dans plusieurs éléments imbriqués (link + span) →
      // .first() pour viser le 1er match sans casser sur strict mode.
      await page.getByRole('button', { name: 'En cours', exact: true }).click();
      await expect(
        page.getByText(pending.codeCommande, { exact: false }).first(),
      ).toBeVisible();
      await expect(page.getByText(completed.codeCommande, { exact: false })).toHaveCount(0);

      // Tab "Terminées" : inverse
      await page.getByRole('button', { name: 'Terminées', exact: true }).click();
      await expect(
        page.getByText(completed.codeCommande, { exact: false }).first(),
      ).toBeVisible();
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
        statut: 'confirmed',
      });

      await loginAs(page, consumer);
      await page.goto(`/compte/commandes/${order.orderId}`);

      // Le code retrait apparaît côté UI dans 2+ éléments (entête mono +
      // bloc dédié <code>). On utilise .first() pour éviter le strict mode
      // violation Playwright tout en validant la présence du code.
      await expect(
        page.getByText(order.codeCommande, { exact: false }).first(),
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await cleanupOrdersForProducers([producer.producerId]);
    }
  });

  test('détail [id] inexistant : notFound (404 page)', async ({ page, ctx }) => {
    test.setTimeout(60_000);

    const consumer = await seedConsumer(ctx, { suffix: 'nf' });
    await loginAs(page, consumer);

    // UUID syntactiquement valide mais inexistant en DB → notFound()
    // Note : en dev Next.js (Turbopack), notFound() peut servir 200 + page
    // 404 dans le DOM (cf. tests/e2e/public/producer-pages.spec.ts ligne 54).
    // On assert sur le contenu de app/not-found.tsx pour rester portable.
    const fakeId = '00000000-0000-0000-0000-000000000000';
    await page.goto(`/compte/commandes/${fakeId}`);
    await expect(
      page.getByRole('heading', { level: 1, name: /cette page n['’]existe plus/i }),
    ).toBeVisible({ timeout: 10_000 });
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
        statut: 'pending',
      });

      // Login en tant que B → tente d'accéder à l'order de A.
      // 2 paths possibles selon que la SSR utilise le client RLS-aware ou
      // le client admin :
      //  - user-client (createSupabaseServerClient) : RLS filtre la row
      //    avant le check applicatif → row null → notFound() (404 page)
      //  - admin client + check applicatif : redirect('/compte/commandes')
      // Le contrat sécurité strict est : "B ne voit pas l'order de A".
      // On accepte les 2 issues UX. Aujourd'hui la page utilise le user
      // client → 404 page. Le test verrouille la propriété d'isolation,
      // pas l'UX précise.
      await loginAs(page, consumerB);
      await page.goto(`/compte/commandes/${order.orderId}`);

      const isOnList = await page
        .getByRole('heading', { name: 'Mes commandes', exact: true })
        .isVisible()
        .catch(() => false);
      const isOnNotFound = await page
        .getByRole('heading', { level: 1, name: /cette page n['’]existe plus/i })
        .isVisible()
        .catch(() => false);
      expect(
        isOnList || isOnNotFound,
        'B doit voir soit /compte/commandes (redirect) soit la page 404 (RLS), jamais l\'order de A',
      ).toBe(true);

      // Garde-fou strict : le code retrait de A ne doit jamais fuiter
      // sur la page rendue à B (anti-leak). toHaveCount(0) reste correct
      // car on cherche absence, pas .first().
      await expect(page.getByText(order.codeCommande, { exact: false })).toHaveCount(0);
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
