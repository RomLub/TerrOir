/**
 * E2E Phase 4 — protection CRON_SECRET sur tous les endpoints cron.
 *
 * Toutes les routes `/api/cron/*` partagent le même `assertCronAuth`
 * (cf lib/cron/auth.ts) qui exige `Authorization: Bearer ${CRON_SECRET}`
 * en comparaison constant-time. Ce smoke vérifie qu'aucun endpoint ne
 * peut être déclenché sans ou avec un secret invalide.
 *
 * Endpoints couverts (cf app/api/cron/*) :
 *   - order-timeout
 *   - review-followup
 *   - disputes-deadline-check
 *   - weekly-payout
 *   - reminder-consumer
 *   - retry-failed-refunds
 *
 * Approche défensive — on POST + on attend un 401 (jamais 200/500). Les
 * routes ne touchent à aucune donnée sans auth.
 */

import { test, expect } from '../helpers/test-context';

const CRON_ENDPOINTS = [
  '/api/cron/order-timeout',
  '/api/cron/review-followup',
  '/api/cron/disputes-deadline-check',
  '/api/cron/weekly-payout',
  '/api/cron/reminder-consumer',
  '/api/cron/retry-failed-refunds',
];

test('cron endpoints sans Authorization → 401 sur tous', async ({ page }) => {
  test.setTimeout(30_000);

  for (const endpoint of CRON_ENDPOINTS) {
    const response = await page.request.post(endpoint, {
      headers: { 'content-type': 'application/json' },
      data: '{}',
    });
    expect(
      response.status(),
      `${endpoint} sans auth devrait renvoyer 401 (got ${response.status()})`,
    ).toBe(401);
  }
});

test('cron endpoints avec CRON_SECRET invalide → 401 sur tous', async ({ page }) => {
  test.setTimeout(30_000);

  for (const endpoint of CRON_ENDPOINTS) {
    const response = await page.request.post(endpoint, {
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer this-is-not-the-real-secret',
      },
      data: '{}',
    });
    expect(
      response.status(),
      `${endpoint} avec secret invalide devrait renvoyer 401 (got ${response.status()})`,
    ).toBe(401);
  }
});
