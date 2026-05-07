/**
 * E2E consumer/producer-interest — formulaire candidature /devenir-producteur.
 *
 * POST /api/producer-interests (anon ou auth). Pattern UPSERT idempotent
 * (INSERT + catch 23505 + UPDATE) côté upsertProducerInterest helper.
 *
 * Couverture :
 *   - Submit form valide → row créée (status: 'created')
 *   - Idempotence : 2e POST même email → status: 'updated'
 *   - Validation : email invalide → 400
 *
 * NB : pas de honeypot natif côté API actuelle (cf. route.ts) — le honeypot
 * UX se ferait côté form public mais pas côté server. On retire ce test du
 * scope.
 */

import { test, expect } from '../helpers/test-context';
import { generateTestEmail } from '../helpers/guards';
import {
  getRawAdminClient,
  trackRowId,
  type TestContext,
} from '../helpers/supabase-admin';

async function trackInterestByEmail(ctx: TestContext, email: string): Promise<void> {
  // La row producer_interests n'a pas de FK user_id, donc cleanupAllTrackedUsers
  // ne la nettoie pas en cascade. On track l'id pour cleanup manuel post-test.
  const admin = getRawAdminClient();
  const { data } = await admin
    .from('producer_interests')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (data?.id) {
    trackRowId(ctx, data.id as string);
  }
}

async function deleteInterestByEmail(email: string): Promise<void> {
  const admin = getRawAdminClient();
  await admin.from('producer_interests').delete().eq('email', email);
}

test.describe('Consumer — /api/producer-interests (devenir-producteur)', () => {
  test('submit form valide : UPSERT initial → status created', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const email = generateTestEmail('producer-interest-1');

    try {
      const res = await page.request.post('/api/producer-interests', {
        data: {
          prenom: 'Pierre',
          nom: 'Eleveur',
          email,
          telephone: '0611111111',
          nom_exploitation: 'Ferme Test E2E',
          commune: 'Le Mans',
          message: 'Test E2E candidature',
        },
      });
      expect(res.status(), await res.text()).toBe(200);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe('created');

      const admin = getRawAdminClient();
      const { data } = await admin
        .from('producer_interests')
        .select('email, nom_exploitation, commune')
        .eq('email', email)
        .single();
      expect(data?.nom_exploitation).toBe('Ferme Test E2E');
      expect(data?.commune).toBe('Le Mans');

      await trackInterestByEmail(ctx, email);
    } finally {
      await deleteInterestByEmail(email);
    }
  });

  test('idempotence email : 2e submit même email → status updated', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const email = generateTestEmail('producer-interest-2');

    try {
      // 1er post
      const r1 = await page.request.post('/api/producer-interests', {
        data: {
          prenom: 'Pierre',
          nom: 'Eleveur',
          email,
          telephone: '0611111111',
          nom_exploitation: 'Ferme V1',
          commune: 'Le Mans',
        },
      });
      expect(r1.status()).toBe(200);
      const b1 = (await r1.json()) as { status: string };
      expect(b1.status).toBe('created');

      await trackInterestByEmail(ctx, email);

      // 2e post — même email, autres champs (test UPSERT)
      const r2 = await page.request.post('/api/producer-interests', {
        data: {
          prenom: 'Pierre',
          nom: 'Eleveur',
          email,
          telephone: '0622222222',
          nom_exploitation: 'Ferme V2',
          commune: 'Allonnes',
        },
      });
      expect(r2.status()).toBe(200);
      const b2 = (await r2.json()) as { status: string };
      expect(b2.status).toBe('updated');

      const admin = getRawAdminClient();
      const { data } = await admin
        .from('producer_interests')
        .select('nom_exploitation, commune, telephone')
        .eq('email', email)
        .single();
      expect(data?.nom_exploitation).toBe('Ferme V2');
      expect(data?.commune).toBe('Allonnes');
      expect(data?.telephone).toBe('0622222222');
    } finally {
      await deleteInterestByEmail(email);
    }
  });

  test('validation : email invalide → 400', async ({ page }) => {
    test.setTimeout(60_000);

    const res = await page.request.post('/api/producer-interests', {
      data: {
        prenom: 'P',
        nom: 'E',
        email: 'pas-un-email',
        telephone: '0611111111',
        nom_exploitation: 'Ferme',
        commune: 'Le Mans',
      },
    });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeTruthy();
  });
});
