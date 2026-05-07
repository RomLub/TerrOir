/**
 * Pilote Phase 1 — validation end-to-end du flag RESEND_TEST_MODE.
 *
 * Flow : POST /api/stock-alerts (anon) → sendTemplate (lib/resend/send.ts)
 * → court-circuit si RESEND_TEST_MODE=true → INSERT test_emails_captured
 * (bypass resend.emails.send). Le test assert la row capturée + le HTML
 * email contient le confirm link.
 *
 * Si la capture échoue (flag pas activé, table absente, gate prod), le
 * waitForCapturedEmail throw timeout. Pour un test pilote, c'est la
 * sentinelle dont on a besoin.
 *
 * NOTE : on ne valide PAS que zéro appel Resend API n'a eu lieu (pas de
 * mock côté Resend dispo dans le webServer Next.js). La preuve "no
 * Resend call" est indirecte : si RESEND_TEST_MODE=true et NODE_ENV !==
 * production, le code emprunte le branch capture (vérifié par tests
 * unitaires lib/resend/send.test.ts) et resend.emails.send() n'est
 * structurellement pas appelée.
 */

import { test, expect } from '../helpers/test-context';
import { seedProducer, seedProduct } from '../helpers/db-seed';
import { waitForCapturedEmail } from '../helpers/mailbox';
import { generateTestEmail } from '../helpers/guards';

test('capture email stock-alert via RESEND_TEST_MODE', async ({ page, ctx }) => {
  test.setTimeout(60_000);

  // SETUP : producer + product en rupture (stock_disponible=0, active=true)
  // Le route POST /api/stock-alerts exige cette combinaison pour autoriser
  // l'inscription à l'alerte (cf. app/api/stock-alerts/route.tsx).
  const producer = await seedProducer(ctx, { suffix: 'alert-pilot' });
  const product = await seedProduct(ctx, {
    producerId: producer.producerId,
    nom: `Pilot OOS Product ${Date.now()}`,
    stockDisponible: 0,
    stockIllimite: false,
    active: true,
  });

  const consumerEmail = generateTestEmail('alert-capture');
  const requestStartedAt = new Date();

  // POST /api/stock-alerts (anon)
  const response = await page.request.post('/api/stock-alerts', {
    data: {
      product_id: product.id,
      email: consumerEmail,
      consent: true,
    },
  });
  expect(response.status(), `stock-alerts POST: ${await response.text()}`).toBe(200);
  const body = (await response.json()) as { status: string };
  expect(body.status).toBe('created');

  // ASSERT : email capturé via flag RESEND_TEST_MODE
  const captured = await waitForCapturedEmail(ctx, {
    to: consumerEmail,
    template: 'stock-alert-confirm',
    since: requestStartedAt,
    timeoutMs: 10_000,
  });

  expect(captured.to_email).toBe(consumerEmail);
  expect(captured.template).toBe('stock-alert-confirm');
  expect(captured.subject.length).toBeGreaterThan(0);
  expect(captured.html, 'html doit être rendu').toBeTruthy();
  expect(captured.html ?? '').toContain('/api/stock-alerts/confirm?token=');
  expect((captured.metadata as { e2e_capture?: boolean }).e2e_capture).toBe(true);
});
