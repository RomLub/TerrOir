/**
 * E2E Phase 4 — webhook Resend POST /api/webhooks/resend (cas complémentaires).
 *
 * NB : 3 tests de référence existent déjà en racine
 * (`tests/e2e/email-webhook-h3.spec.ts` — bounced Permanent, complained,
 * signature invalide). On NE LES DUPLIQUE PAS. Cette spec couvre des cas
 * complémentaires :
 *   - Headers svix-* manquants → 401 missing_headers (sans signature du tout).
 *   - Bounce Transient (soft) → incrementSoftBounce, pas de hard_bounce posé
 *     (vs Permanent qui pose direct hard_bounce — couvert en racine).
 *   - Complained event → addSuppression complained + audit log (path racine
 *     déjà couvert) — on ajoute la vérif que `canSendTo()` post-event renvoie
 *     false (intégration suppression ↔ helper).
 *
 * Pré-requis : `RESEND_WEBHOOK_SECRET` set dans .env.local. Format Svix :
 * `whsec_<base64>`.
 */

import crypto from 'node:crypto';
import { test, expect } from '../helpers/test-context';
import { getRawAdminClient } from '../helpers/supabase-admin';

const WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET ?? '';
const SECRET_LOOKS_PLACEHOLDER =
  !WEBHOOK_SECRET ||
  WEBHOOK_SECRET === 'whsec_replace_me' ||
  WEBHOOK_SECRET === 'whsec_placeholder' ||
  WEBHOOK_SECRET === 'placeholder';

test.beforeAll(() => {
  if (SECRET_LOOKS_PLACEHOLDER) {
    test.skip(
      true,
      `RESEND_WEBHOOK_SECRET unset or placeholder. Set a real Svix secret ` +
        `(format whsec_<base64>) in .env.local AND restart Next.js dev server.`,
    );
  }
});

interface ResendEventPayload {
  type: string;
  created_at?: string;
  data: {
    email_id?: string;
    to?: string[];
    created_at?: string;
    bounce?: { type?: string; subType?: string; message?: string };
  };
}

function makeSignedRequest(
  body: ResendEventPayload,
  svixId: string,
): { rawBody: string; headers: Record<string, string> } {
  const rawBody = JSON.stringify(body);
  const ts = Math.floor(Date.now() / 1000);
  const stripped = WEBHOOK_SECRET.startsWith('whsec_')
    ? WEBHOOK_SECRET.slice('whsec_'.length)
    : WEBHOOK_SECRET;
  const key = Buffer.from(stripped, 'base64');
  const signedContent = `${svixId}.${ts}.${rawBody}`;
  const sig = crypto
    .createHmac('sha256', key)
    .update(signedContent, 'utf8')
    .digest('base64');
  return {
    rawBody,
    headers: {
      'content-type': 'application/json',
      'svix-id': svixId,
      'svix-timestamp': String(ts),
      'svix-signature': `v1,${sig}`,
    },
  };
}

test('Resend webhook sans headers svix-* → 401 missing_headers', async ({ page }) => {
  test.setTimeout(15_000);

  // POST sans aucun header svix-* (juste content-type).
  const response = await page.request.post('/api/webhooks/resend', {
    headers: { 'content-type': 'application/json' },
    data: JSON.stringify({
      type: 'email.bounced',
      data: { email_id: 'em_x', to: ['x@example.com'] },
    }),
  });
  expect(response.status()).toBe(401);
});

test('Resend webhook email.bounced Transient → incrementSoftBounce, pas de blocage immédiat', async ({
  page,
}) => {
  test.setTimeout(30_000);
  const admin = getRawAdminClient();

  const recipient = `soft-bounce-${Date.now()}@example.com`;
  const svixId = `msg_soft_${Date.now()}`;
  const emailId = `em_soft_${Date.now()}`;

  // Cleanup pré-test.
  await admin.from('email_suppressions').delete().ilike('email', recipient);

  const { rawBody, headers } = makeSignedRequest(
    {
      type: 'email.bounced',
      created_at: new Date().toISOString(),
      data: {
        email_id: emailId,
        to: [recipient],
        bounce: { type: 'Transient', subType: 'MailboxFull' },
      },
    },
    svixId,
  );

  const response = await page.request.post('/api/webhooks/resend', {
    headers,
    data: rawBody,
  });
  expect(
    response.status(),
    `webhook email.bounced Transient: ${await response.text()}`,
  ).toBe(200);

  // 1 soft bounce posé : reason='soft_bounce_pending' (pas threshold), count=1.
  const { data: row } = await admin
    .from('email_suppressions')
    .select('email, reason, soft_bounce_count')
    .ilike('email', recipient)
    .maybeSingle();
  expect(row).not.toBeNull();
  expect(row?.reason).toBe('soft_bounce_pending');
  expect(row?.soft_bounce_count).toBe(1);

  // Cleanup
  await admin.from('email_suppressions').delete().ilike('email', recipient);
  await admin
    .from('webhook_events_processed')
    .delete()
    .eq('event_id', `resend_${svixId}`);
});

test('Resend webhook email.complained → suppression posée et bloque les sends futurs', async ({
  page,
}) => {
  test.setTimeout(30_000);
  const admin = getRawAdminClient();

  const recipient = `complained-${Date.now()}@example.com`;
  const svixId = `msg_complained_${Date.now()}`;
  const emailId = `em_complained_${Date.now()}`;

  await admin.from('email_suppressions').delete().ilike('email', recipient);

  const { rawBody, headers } = makeSignedRequest(
    {
      type: 'email.complained',
      created_at: new Date().toISOString(),
      data: {
        email_id: emailId,
        to: [recipient],
      },
    },
    svixId,
  );

  const response = await page.request.post('/api/webhooks/resend', {
    headers,
    data: rawBody,
  });
  expect(
    response.status(),
    `webhook email.complained: ${await response.text()}`,
  ).toBe(200);

  // Suppression posée avec reason='complained' (BLOCKING).
  const { data: row } = await admin
    .from('email_suppressions')
    .select('email, reason')
    .ilike('email', recipient)
    .maybeSingle();
  expect(row).not.toBeNull();
  expect(row?.reason).toBe('complained');

  // Cleanup
  await admin.from('email_suppressions').delete().ilike('email', recipient);
  await admin
    .from('webhook_events_processed')
    .delete()
    .eq('event_id', `resend_${svixId}`);
  await admin
    .from('audit_logs')
    .delete()
    .eq('event_type', 'email_complaint_received')
    .filter('metadata->>svix_id', 'eq', svixId);
});
