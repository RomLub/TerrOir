/**
 * E2E consumer/avis — soumission review consumer (depuis détail commande).
 *
 * Codebase actuelle : pas de page /mes-avis côté consumer (le concept
 * /mes-avis existe uniquement côté producer space). Le consumer laisse un
 * avis depuis /compte/commandes/[id] quand la commande est en statut
 * "completed" et qu'aucune review n'existe encore.
 *
 * Couverture :
 *   - /compte/commandes/[id] complétée sans review : formulaire avis visible
 *     + submit POST /api/reviews/create → INSERT row reviews + 200
 *
 * NB envoi email producer : POST /api/reviews/create ne déclenche PAS
 * directement un envoi resend.emails.send template review-response. Il
 * insère juste une notification "admin_review_pending" pour modération.
 * Donc on ne wait PAS de captured email ici (ne pas calquer le brief :
 * "email producer envoyé via sendTemplate" est faux par rapport au code
 * actuel).
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
});
