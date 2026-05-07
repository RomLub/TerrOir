/**
 * Phase 2 — flow complet stock-alerts (subscribe → confirm → unsubscribe).
 *
 * Le pilote Phase 1 (stock-alert-capture.spec.ts) couvre déjà le subscribe
 * + capture de l'email confirm. Ici on enchaîne :
 *
 *   1. confirm via token : POST /api/stock-alerts/confirm avec token
 *      récupéré depuis la DB → assert confirmed_at NOT NULL.
 *   2. unsubscribe via token : POST /api/stock-alerts/unsubscribe avec
 *      token récupéré depuis la DB → assert unsubscribed_at NOT NULL.
 *
 * IMPORTANT : les routes sont 2-step opt-in/opt-out (cf. fichiers
 * route.ts) — un GET retourne juste un form HTML, c'est le POST
 * form-encoded avec input hidden token=xxx qui exécute l'action. C'est
 * une protection anti-prefetcher email (Outlook Safe Links etc.).
 *
 * On ne ré-asserte PAS la capture email (couverte par le pilote). On
 * pull les tokens directement de la table stock_alerts via service_role
 * pour éviter le parsing HTML email.
 */

import { test, expect } from '../helpers/test-context';
import { seedProducer, seedProduct } from '../helpers/db-seed';
import { generateTestEmail } from '../helpers/guards';
import {
  getRawAdminClient,
  trackRowId,
  type TestContext,
} from '../helpers/supabase-admin';

interface StockAlertRow {
  id: string;
  confirm_token: string;
  unsubscribe_token: string;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
}

async function createStockAlertViaApi(
  page: import('@playwright/test').Page,
  ctx: TestContext,
  productId: string,
  email: string,
): Promise<StockAlertRow> {
  const response = await page.request.post('/api/stock-alerts', {
    data: {
      product_id: productId,
      email,
      consent: true,
    },
  });
  expect(response.status(), `stock-alerts POST: ${await response.text()}`).toBe(
    200,
  );

  const admin = getRawAdminClient();
  const { data, error } = await admin
    .from('product_stock_alerts')
    .select('id, confirm_token, unsubscribe_token, confirmed_at, unsubscribed_at')
    .eq('product_id', productId)
    .eq('email', email)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (error || !data) {
    throw new Error(
      `stock_alerts row introuvable post-create : ${error?.message ?? 'no data'}`,
    );
  }
  trackRowId(ctx, data.id as string);
  return data as StockAlertRow;
}

test.describe('stock-alerts flow confirm + unsubscribe', () => {
  test('confirm via token POST → confirmed_at NOT NULL', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const producer = await seedProducer(ctx, { suffix: 'alert-confirm' });
    const product = await seedProduct(ctx, {
      producerId: producer.producerId,
      nom: `Confirm OOS Product ${Date.now()}`,
      stockDisponible: 0,
      stockIllimite: false,
      active: true,
    });

    const email = generateTestEmail('stockalert-confirm');
    const alert = await createStockAlertViaApi(page, ctx, product.id, email);
    expect(alert.confirmed_at, 'pre-confirm sanity').toBeNull();

    // POST form-encoded (cf. route.ts : 2-step opt-in)
    const formResp = await page.request.post('/api/stock-alerts/confirm', {
      form: { token: alert.confirm_token },
      maxRedirects: 0, // 303 redirect attendu vers /alertes-stock/confirm
    });
    expect([200, 303]).toContain(formResp.status());

    // Verif DB : confirmed_at posé
    const admin = getRawAdminClient();
    const { data, error } = await admin
      .from('product_stock_alerts')
      .select('confirmed_at')
      .eq('id', alert.id)
      .single();
    expect(error, 'fetch post-confirm').toBeNull();
    expect(data?.confirmed_at, 'confirmed_at must be set').not.toBeNull();
  });

  test('unsubscribe via token POST → unsubscribed_at NOT NULL', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const producer = await seedProducer(ctx, { suffix: 'alert-unsub' });
    const product = await seedProduct(ctx, {
      producerId: producer.producerId,
      nom: `Unsub OOS Product ${Date.now()}`,
      stockDisponible: 0,
      stockIllimite: false,
      active: true,
    });

    const email = generateTestEmail('stockalert-unsub');
    const alert = await createStockAlertViaApi(page, ctx, product.id, email);
    expect(alert.unsubscribed_at, 'pre-unsub sanity').toBeNull();

    const formResp = await page.request.post('/api/stock-alerts/unsubscribe', {
      form: { token: alert.unsubscribe_token },
      maxRedirects: 0,
    });
    expect([200, 303]).toContain(formResp.status());

    const admin = getRawAdminClient();
    const { data, error } = await admin
      .from('product_stock_alerts')
      .select('unsubscribed_at')
      .eq('id', alert.id)
      .single();
    expect(error, 'fetch post-unsub').toBeNull();
    expect(data?.unsubscribed_at, 'unsubscribed_at must be set').not.toBeNull();
  });

  test('GET /api/stock-alerts/confirm → form HTML 200 (pas d\'effet DB)', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    // Le GET ne doit JAMAIS confirmer — c'est la garantie anti-prefetcher.
    // On crée une alert puis on GET avec son token et on assert que
    // confirmed_at reste null.
    const producer = await seedProducer(ctx, { suffix: 'alert-getsafe' });
    const product = await seedProduct(ctx, {
      producerId: producer.producerId,
      nom: `GetSafe OOS Product ${Date.now()}`,
      stockDisponible: 0,
      stockIllimite: false,
      active: true,
    });

    const email = generateTestEmail('stockalert-getsafe');
    const alert = await createStockAlertViaApi(page, ctx, product.id, email);

    const getResp = await page.request.get(
      `/api/stock-alerts/confirm?token=${encodeURIComponent(alert.confirm_token)}`,
    );
    expect(getResp.status()).toBe(200);
    const ct = getResp.headers()['content-type'] ?? '';
    expect(ct).toContain('text/html');

    // DB : confirmed_at toujours null (le GET n'a PAS confirmé)
    const admin = getRawAdminClient();
    const { data } = await admin
      .from('product_stock_alerts')
      .select('confirmed_at')
      .eq('id', alert.id)
      .single();
    expect(data?.confirmed_at, 'GET must NOT trigger confirm').toBeNull();
  });
});
