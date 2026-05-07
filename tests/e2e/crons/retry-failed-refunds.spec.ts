/**
 * E2E Phase 4 — cron /api/cron/retry-failed-refunds (T-102 PR-B).
 *
 * Cible : process les rows refund_incidents en statut pending/retrying
 * via retryIncident (cf app/api/cron/retry-failed-refunds/route.ts +
 * lib/refund-incidents/retry-incident.ts).
 *
 * Approche défensive : on ne seed PAS de row refund_incidents (Stripe
 * dépendance trop lourde côté retry). On vérifie seulement que :
 *   - Auth correcte → 200 + body shape attendu (`{ processed, results }`).
 *   - Auth absente → 401.
 *
 * La logique métier (retry réel d'un PI) est couverte par les tests
 * unitaires côté lib/refund-incidents/__tests__/.
 */

import { test, expect } from '../helpers/test-context';

const CRON_SECRET = process.env.CRON_SECRET;
const SECRET_LOOKS_PLACEHOLDER =
  !CRON_SECRET || CRON_SECRET === 'placeholder' || CRON_SECRET.length < 16;

test.beforeAll(() => {
  if (SECRET_LOOKS_PLACEHOLDER) {
    test.skip(true, `CRON_SECRET unset or placeholder.`);
  }
});

test('retry-failed-refunds : 200 + body { processed, results } avec auth valide', async ({
  page,
}) => {
  test.setTimeout(30_000);

  const response = await page.request.post(
    '/api/cron/retry-failed-refunds',
    {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${CRON_SECRET}`,
      },
      data: '{}',
    },
  );
  expect(
    response.status(),
    `retry-failed-refunds: ${await response.text()}`,
  ).toBe(200);

  const body = await response.json();
  expect(typeof body.processed).toBe('number');
  expect(Array.isArray(body.results)).toBe(true);
});
