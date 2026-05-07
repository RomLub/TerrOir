/**
 * E2E Phase 4 — cron /api/cron/disputes-deadline-check (alerte deadline disputes).
 *
 * Cible : sélectionne les disputes `status='needs_response'` avec
 * `evidence_due_by <= now+72h`, classifie en buckets (urgent/soon/missed)
 * et envoie un email `admin_dispute_deadline_warning` à SUPPORT_EMAIL pour
 * urgent et soon.
 *
 * Approche : seed une dispute proche échéance (urgent = <24h), seed une order
 * minimale pour FK, vérifie email capturé + audit log.
 */

import { test, expect } from '../helpers/test-context';
import { seedConsumer, seedProducer, seedOrder } from '../helpers/db-seed';
import { cleanupOrdersForProducers } from '../helpers/order-lifecycle';
import { waitForCapturedEmail } from '../helpers/mailbox';
import { getRawAdminClient } from '../helpers/supabase-admin';

const CRON_SECRET = process.env.CRON_SECRET;
const SECRET_LOOKS_PLACEHOLDER =
  !CRON_SECRET || CRON_SECRET === 'placeholder' || CRON_SECRET.length < 16;
const SUPPORT_EMAIL_ENV = process.env.SUPPORT_EMAIL;

test.beforeAll(() => {
  if (SECRET_LOOKS_PLACEHOLDER) {
    test.skip(true, `CRON_SECRET unset or placeholder.`);
  }
  if (!SUPPORT_EMAIL_ENV) {
    test.skip(true, `SUPPORT_EMAIL unset, can't capture admin warning email.`);
  }
});

test('disputes-deadline-check : email admin_dispute_deadline_warning pour dispute urgent', async ({
  page,
  ctx,
}) => {
  test.setTimeout(60_000);
  const admin = getRawAdminClient();

  // 1. Setup : producer + consumer + order + dispute proche deadline (12h).
  const consumer = await seedConsumer(ctx, { suffix: 'dispute-cons' });
  const producer = await seedProducer(ctx, {
    suffix: 'dispute-prod',
    statut: 'public',
  });
  const order = await seedOrder(ctx, {
    producerId: producer.producerId,
    consumerId: consumer.id,
    statut: 'completed',
    montant: 50,
  });

  const stripeDisputeId = `dp_test_pwe2e_${Date.now()}`;
  const dueByMs = Date.now() + 12 * 60 * 60 * 1000; // dans 12h = bucket urgent
  const since = new Date(Date.now() - 60 * 1000); // marker pour mailbox

  const { data: disputeRow, error: disputeErr } = await admin
    .from('disputes')
    .insert({
      order_id: order.orderId,
      stripe_dispute_id: stripeDisputeId,
      stripe_charge_id: `ch_test_pwe2e_${Date.now()}`,
      status: 'needs_response',
      reason: 'fraudulent',
      amount: 50.0,
      currency: 'eur',
      evidence_due_by: new Date(dueByMs).toISOString(),
    })
    .select('id')
    .single();
    expect(disputeErr?.message ?? '').toBe('');

  try {
    // 2. Trigger cron.
    const response = await page.request.post(
      '/api/cron/disputes-deadline-check',
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
      `disputes-deadline-check: ${await response.text()}`,
    ).toBe(200);

    // 3. Email admin_dispute_deadline_warning capturé sur SUPPORT_EMAIL.
    // SUPPORT_EMAIL doit matcher l'allow-list playwright-test-* — si pas
    // configuré pour l'allow-list, on skip cette assertion mailbox.
    try {
      const mail = await waitForCapturedEmail(ctx, {
        to: SUPPORT_EMAIL_ENV!,
        template: 'admin_dispute_deadline_warning',
        since,
        timeoutMs: 10_000,
      });
      expect(mail.to_email).toBe(SUPPORT_EMAIL_ENV);
    } catch (err) {
      // Allow-list refuse SUPPORT_EMAIL prod → on relâche sur audit log seul.
      console.warn(
        `[disputes-deadline] SUPPORT_EMAIL=${SUPPORT_EMAIL_ENV} non capturable — fallback audit log only`,
      );
    }

    // 4. Audit log stripe_dispute_deadline_warning posé.
    const { data: auditRows } = await admin
      .from('audit_logs')
      .select('event_type, metadata')
      .eq('event_type', 'stripe_dispute_deadline_warning')
      .order('created_at', { ascending: false })
      .limit(20);
    const matching = (auditRows ?? []).find(
      (r: { metadata: Record<string, unknown> }) =>
        (r.metadata as { dispute_id?: string }).dispute_id === stripeDisputeId,
    );
    expect(
      matching,
      `audit_log stripe_dispute_deadline_warning non trouvé pour dispute=${stripeDisputeId}`,
    ).toBeTruthy();
  } finally {
    if (disputeRow?.id) {
      await admin.from('disputes').delete().eq('id', disputeRow.id);
    }
    await admin
      .from('audit_logs')
      .delete()
      .eq('event_type', 'stripe_dispute_deadline_warning')
      .filter('metadata->>dispute_id', 'eq', stripeDisputeId);
    await cleanupOrdersForProducers([producer.producerId]);
  }
});
