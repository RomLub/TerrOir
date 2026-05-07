/**
 * E2E consumer/avis — flow /compte/mes-avis (cycle qualité 2026-05-07).
 *
 * Mini-feature livrée Phase 2 :
 *   - /compte/mes-avis : liste mélangée "À donner" en haut + "Donnés" en bas
 *   - /compte/mes-avis/[orderId]/nouveau : formulaire saisie avis avec
 *     validation Zod conditionnelle (note ≤ 3 → commentaire ≥ 10 chars)
 *   - Submit via server action → INSERT review + redirect /compte/mes-avis?success=1
 *
 * Couverture (4 tests) :
 *   1. POST /api/reviews/create note=5 sans commentaire → 200 INSERT (API direct)
 *   2. POST /api/reviews/create order pending → 409 (API direct)
 *   3. UI flow complet : navigation /compte/mes-avis → form → submit → success
 *   4. Validation conditionnelle Zod : note=2 sans commentaire → 400
 *
 * NB envoi email producer : ni POST /api/reviews/create ni la server action
 * /compte/mes-avis/[orderId]/nouveau ne déclenche un envoi resend direct.
 * Ils insèrent juste une notification "admin_review_pending" pour modération.
 * Donc on ne wait PAS de captured email ici.
 *
 * Le path /compte/mes-avis est volontaire (pas /mes-avis) pour éviter le
 * conflit de routes parallèles avec /(producer)/mes-avis qui existe déjà.
 */

import { test, expect } from '../helpers/test-context';
import { seedConsumer, seedProducer, seedOrder } from '../helpers/db-seed';
import { loginAs } from '../helpers/user-lifecycle';
import {
  cleanupOrdersForProducers,
} from '../helpers/order-lifecycle';
import {
  getReadOnlyAdminClient,
  safeDelete,
} from '../helpers/supabase-admin';

test.describe('Consumer — Submit review depuis /compte/commandes/[id]', () => {
  test('order completed sans review : POST /api/reviews/create OK + INSERT DB', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(120_000);

    const consumer = await seedConsumer(ctx, { suffix: 'review-ok' });
    const producer = await seedProducer(ctx, {
      suffix: 'review-prod',
      statut: 'public',
    });

    try {
      const order = await seedOrder(ctx, {
        producerId: producer.producerId,
        consumerId: consumer.id,
        codeCommande: `REV-${Date.now()}-X`,
        statut: 'completed',
      });

      await loginAs(page, consumer);

      const res = await page.request.post('/api/reviews/create', {
        data: {
          order_id: order.orderId,
          note: 5,
          commentaire: 'Excellent test E2E.',
        },
      });
      expect(res.status(), await res.text()).toBe(200);
      const body = (await res.json()) as { review_id: string; statut: string };
      expect(body.review_id).toBeTruthy();
      expect(body.statut).toBe('pending');

      // Vérification DB
      const admin = getReadOnlyAdminClient();
      const { data: review } = await admin
        .from('reviews')
        .select('note, commentaire, statut, consumer_id, producer_id')
        .eq('id', body.review_id)
        .single();
      expect(review?.note).toBe(5);
      expect(review?.commentaire).toBe('Excellent test E2E.');
      expect(review?.statut).toBe('pending');
      expect(review?.consumer_id).toBe(consumer.id);
      expect(review?.producer_id).toBe(producer.producerId);

      // Cleanup review (FK reviews.producer_id NO ACTION → bloquerait
      // delete producer plus tard via cleanupAllTrackedUsers).
      await safeDelete(ctx, 'reviews', { id: body.review_id }).catch(() => {});
    } finally {
      // Purge orders + reviews (orders FK consumer/producer NO ACTION).
      const admin = getReadOnlyAdminClient();
      await admin.from('reviews').delete().eq('producer_id', producer.producerId);
      await cleanupOrdersForProducers([producer.producerId]);
    }
  });

  test('order non-completed : POST /api/reviews/create → 409', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(120_000);

    const consumer = await seedConsumer(ctx, { suffix: 'review-409' });
    const producer = await seedProducer(ctx, {
      suffix: 'review-409-prod',
      statut: 'public',
    });

    try {
      const order = await seedOrder(ctx, {
        producerId: producer.producerId,
        consumerId: consumer.id,
        codeCommande: `R409-${Date.now()}-X`,
        statut: 'pending', // non-completed
      });

      await loginAs(page, consumer);
      const res = await page.request.post('/api/reviews/create', {
        data: { order_id: order.orderId, note: 4 },
      });
      expect(res.status()).toBe(409);
    } finally {
      const admin = getReadOnlyAdminClient();
      await admin.from('reviews').delete().eq('producer_id', producer.producerId);
      await cleanupOrdersForProducers([producer.producerId]);
    }
  });

  test('UI flow /compte/mes-avis : ordersToReview → form → submit → success', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(120_000);

    const consumer = await seedConsumer(ctx, { suffix: 'mes-avis-ui' });
    const producer = await seedProducer(ctx, {
      suffix: 'mes-avis-ui-prod',
      statut: 'public',
    });

    try {
      const order = await seedOrder(ctx, {
        producerId: producer.producerId,
        consumerId: consumer.id,
        statut: 'completed',
      });

      await loginAs(page, consumer);
      await page.goto('/compte/mes-avis');

      // Section "À donner" affiche l'order completed sans review
      await expect(
        page.getByRole('heading', { name: 'À donner', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(order.codeCommande, { exact: false }).first(),
      ).toBeVisible();

      // Clic "Laisser un avis" → /compte/mes-avis/[orderId]/nouveau
      await page
        .getByRole('link', { name: /Laisser un avis/i })
        .first()
        .click();
      await page.waitForURL(/\/compte\/mes-avis\/[^/]+\/nouveau/, {
        timeout: 10_000,
      });

      // Formulaire monté avec note=5 par défaut (StarRating)
      await expect(
        page.getByRole('heading', { name: 'Laisser un avis', exact: true }),
      ).toBeVisible();

      // Remplir le commentaire (optionnel pour note=5, mais on en met un)
      await page
        .getByLabel(/Commentaire/i)
        .fill('Excellent producteur, viande savoureuse et accueil chaleureux.');

      // Submit
      await page.getByRole('button', { name: /Publier mon avis/i }).click();

      // Redirect vers /compte/mes-avis?success=1
      await page.waitForURL(/\/compte\/mes-avis\?success=1/, {
        timeout: 10_000,
      });
      await expect(
        page.getByText(/Ton avis a bien été enregistré/i),
      ).toBeVisible();

      // Vérification DB : review inséré avec statut=pending
      const admin = getReadOnlyAdminClient();
      const { data: review } = await admin
        .from('reviews')
        .select('note, commentaire, statut, consumer_id, producer_id, order_id')
        .eq('order_id', order.orderId)
        .single();
      expect(review?.note).toBe(5);
      expect(review?.commentaire).toContain('Excellent producteur');
      expect(review?.statut).toBe('pending');
      expect(review?.consumer_id).toBe(consumer.id);
      expect(review?.producer_id).toBe(producer.producerId);
    } finally {
      const admin = getReadOnlyAdminClient();
      await admin.from('reviews').delete().eq('producer_id', producer.producerId);
      await cleanupOrdersForProducers([producer.producerId]);
    }
  });

  test('validation conditionnelle : note ≤ 3 sans commentaire ≥ 10 chars → 400', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(120_000);

    const consumer = await seedConsumer(ctx, { suffix: 'review-cond' });
    const producer = await seedProducer(ctx, {
      suffix: 'review-cond-prod',
      statut: 'public',
    });

    try {
      const order = await seedOrder(ctx, {
        producerId: producer.producerId,
        consumerId: consumer.id,
        statut: 'completed',
      });

      await loginAs(page, consumer);

      // Note ≤ 3 sans commentaire → 400 par validation Zod conditionnelle
      const noComment = await page.request.post('/api/reviews/create', {
        data: { order_id: order.orderId, note: 2 },
      });
      expect(noComment.status()).toBe(400);
      const body1 = await noComment.json();
      expect(body1.error).toMatch(/commentaire.*10 caractères/i);

      // Note ≤ 3 avec commentaire trop court → 400
      const tooShort = await page.request.post('/api/reviews/create', {
        data: { order_id: order.orderId, note: 2, commentaire: 'Trop' },
      });
      expect(tooShort.status()).toBe(400);

      // Note ≤ 3 avec commentaire ≥ 10 chars → 200 OK
      const valid = await page.request.post('/api/reviews/create', {
        data: {
          order_id: order.orderId,
          note: 2,
          commentaire: 'Vraiment décevant cette fois, dommage.',
        },
      });
      expect(valid.status()).toBe(200);
    } finally {
      const admin = getReadOnlyAdminClient();
      await admin.from('reviews').delete().eq('producer_id', producer.producerId);
      await cleanupOrdersForProducers([producer.producerId]);
    }
  });
});
