/**
 * Smoke E2E Audit Email H-3 + M-5 (2026-05-05) — webhook Resend entrant.
 *
 * Approche : POST direct sur /api/webhooks/resend avec un payload JSON
 * + signature Svix valide construite côté test, puis vérification
 * email_suppressions row créée. Pattern aligné avec stripe-webhooks-m3.spec.ts
 * (signed-webhook self-contained, pas de dépendance à un tooling externe).
 *
 * Pré-requis :
 *  - RESEND_WEBHOOK_SECRET set dans .env.local côté serveur Next.js (même
 *    valeur que côté test). Si 'whsec_placeholder' ou unset → skip explicite
 *    avec instructions Romain.
 *  - Format secret Svix : "whsec_<base64>". Pour le local : openssl rand
 *    -base64 24 puis préfixer "whsec_".
 *
 * Cleanup : DELETE des rows email_suppressions et webhook_events_processed
 * créées par chaque test pour éviter pollution prod-DB.
 */

import crypto from 'node:crypto';
import { test, expect } from './helpers/test-context';
import { getRawAdminClient } from './helpers/supabase-admin';

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
        `(format whsec_<base64>) in .env.local AND restart Next.js dev server. ` +
        `For local-only smoke, generate one via: ` +
        `node -e "console.log('whsec_'+require('crypto').randomBytes(24).toString('base64'))"`,
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

test('H-3 email.bounced (Permanent) → addSuppression hard_bounce + audit log', async ({
  page,
}) => {
  test.setTimeout(30_000);
  const admin = getRawAdminClient();

  const recipient = `bounced-h3-${Date.now()}@example.com`;
  const svixId = `msg_h3_bounce_${Date.now()}`;
  const emailId = `em_h3_${Date.now()}`;

  // Cleanup pré-test (au cas où un test précédent aurait laissé des restes
  // sur la même prod-DB).
  await admin.from('email_suppressions').delete().eq('email', recipient);

  const { rawBody, headers } = makeSignedRequest(
    {
      type: 'email.bounced',
      created_at: new Date().toISOString(),
      data: {
        email_id: emailId,
        to: [recipient],
        bounce: { type: 'Permanent', subType: 'Suppressed' },
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
    `webhook email.bounced: ${await response.text()}`,
  ).toBe(200);

  // Vérifier email_suppressions row créée avec reason='hard_bounce'.
  const { data: row, error: readErr } = await admin
    .from('email_suppressions')
    .select('email, reason, source_resend_id')
    .eq('email', recipient)
    .maybeSingle();
  expect(readErr?.message ?? '').toBe('');
  expect(row).not.toBeNull();
  expect(row?.reason).toBe('hard_bounce');
  expect(row?.source_resend_id).toBe(emailId);

  // Vérifier audit log email_hard_bounce_suppressed posé.
  const { data: auditRows } = await admin
    .from('audit_logs')
    .select('event_type, metadata')
    .eq('event_type', 'email_hard_bounce_suppressed')
    .order('created_at', { ascending: false })
    .limit(20);
  const matching = (auditRows ?? []).find(
    (r: { metadata: Record<string, unknown> }) =>
      (r.metadata as { svix_id?: string }).svix_id === svixId,
  );
  expect(matching, 'audit_log email_hard_bounce_suppressed').toBeTruthy();

  // Replay : same svix-id → 200 deduped:true, pas de nouvel audit log.
  const replayResponse = await page.request.post('/api/webhooks/resend', {
    headers,
    data: rawBody,
  });
  expect(replayResponse.status()).toBe(200);
  const replayBody = await replayResponse.json();
  expect(replayBody.deduped).toBe(true);

  // Cleanup
  await admin.from('email_suppressions').delete().eq('email', recipient);
  await admin
    .from('webhook_events_processed')
    .delete()
    .eq('event_id', `resend_${svixId}`);
  await admin
    .from('audit_logs')
    .delete()
    .eq('event_type', 'email_hard_bounce_suppressed')
    .filter('metadata->>svix_id', 'eq', svixId);
});

test('H-3 email.complained → addSuppression complained + audit log légal', async ({
  page,
}) => {
  test.setTimeout(30_000);
  const admin = getRawAdminClient();

  const recipient = `complainer-h3-${Date.now()}@example.com`;
  const svixId = `msg_h3_complaint_${Date.now()}`;
  const emailId = `em_h3_complaint_${Date.now()}`;

  await admin.from('email_suppressions').delete().eq('email', recipient);

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

  const { data: row } = await admin
    .from('email_suppressions')
    .select('email, reason, source_resend_id')
    .eq('email', recipient)
    .maybeSingle();
  expect(row).not.toBeNull();
  expect(row?.reason).toBe('complained');

  const { data: auditRows } = await admin
    .from('audit_logs')
    .select('event_type, metadata')
    .eq('event_type', 'email_complaint_received')
    .order('created_at', { ascending: false })
    .limit(20);
  const matching = (auditRows ?? []).find(
    (r: { metadata: Record<string, unknown> }) =>
      (r.metadata as { svix_id?: string }).svix_id === svixId,
  );
  expect(matching, 'audit_log email_complaint_received').toBeTruthy();

  // Cleanup
  await admin.from('email_suppressions').delete().eq('email', recipient);
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

test('H-3 signature invalide → 401, pas de side-effect DB', async ({ page }) => {
  test.setTimeout(15_000);
  const admin = getRawAdminClient();

  const recipient = `invalid-sig-${Date.now()}@example.com`;
  const svixId = `msg_invalid_${Date.now()}`;
  const rawBody = JSON.stringify({
    type: 'email.bounced',
    data: {
      email_id: 'em_invalid',
      to: [recipient],
      bounce: { type: 'Permanent' },
    },
  });

  const response = await page.request.post('/api/webhooks/resend', {
    headers: {
      'content-type': 'application/json',
      'svix-id': svixId,
      'svix-timestamp': String(Math.floor(Date.now() / 1000)),
      'svix-signature': 'v1,bogusbase64ZZZZZZZZZZZZ==',
    },
    data: rawBody,
  });
  expect(response.status()).toBe(401);

  // Aucune row email_suppressions ne doit avoir été créée.
  const { data: row } = await admin
    .from('email_suppressions')
    .select('email')
    .eq('email', recipient)
    .maybeSingle();
  expect(row).toBeNull();
});
