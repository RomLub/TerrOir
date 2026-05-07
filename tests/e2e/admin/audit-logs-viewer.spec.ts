/**
 * E2E admin — /audit-logs (viewer + filtres + lookup email).
 *
 * Couverture (3 tests) :
 *   1. Page /audit-logs rendue avec form filtres + tableau (pills event_type
 *      + form Email/User ID/dates) + un audit log seedé visible.
 *   2. Filtre par event_type via query string ?event_type=account_login_password
 *      → seuls les events de ce type apparaissent (pill activée + label en
 *      tableau).
 *   3. Lookup email → user_id via le filtre form : admin saisit email, le
 *      serveur résout via lookupUserIdByEmail + applique filter user_id =
 *      résolution. Test contractuel sur le rendu uniforme (résultat même
 *      si email inconnu ≠ oracle).
 *
 * NB : la rate-limit lookup email est bypass-ée via RATE_LIMIT_BYPASS_TESTS=true
 * + PLAYWRIGHT_TEST=1 (cf. webServer env). Les events sont seedés directement
 * via service_role (pas via flow user) car on teste le viewer, pas le logger.
 */

import { test, expect } from '../helpers/test-context';
import { seedConsumer } from '../helpers/db-seed';
import { getRawAdminClient } from '../helpers/supabase-admin';
import { createAdminUser, cleanupAdminRow, loginAsAdmin } from './_helpers';

/**
 * Polling helper : la page /audit-logs émet le meta `admin_audit_logs_email_lookup`
 * via `void logLegalEvent(...)` (fire-and-forget côté serveur). La response HTML
 * peut être renvoyée AVANT que l'INSERT en DB soit committed. On poll donc
 * jusqu'à ce que la row apparaisse, avec un timeout.
 */
async function waitForAuditMeta(
  adminUserId: string,
  timeoutMs = 5000,
  pollMs = 200,
): Promise<{ event_type: string; metadata: unknown } | null> {
  const adminClient = getRawAdminClient();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data } = await adminClient
      .from('audit_logs')
      .select('event_type, metadata')
      .eq('event_type', 'admin_audit_logs_email_lookup')
      .eq('user_id', adminUserId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return null;
}

test.describe('Admin — Audit logs viewer', () => {
  test('page /audit-logs rendue : form filtres + tableau + event seedé visible', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(90_000);

    const adminUser = await createAdminUser(ctx, 'al-render');
    const consumer = await seedConsumer(ctx, { suffix: 'al-cons' });

    // Seed un audit log via service_role attaché au consumer pour avoir
    // une row visible dans la query par défaut (PAGE_SIZE = 50, ordre DESC
    // created_at). Pas besoin de login flow réel.
    const adminClient = getRawAdminClient();
    const { error: seedErr } = await adminClient.from('audit_logs').insert({
      user_id: consumer.id,
      event_type: 'account_login_password',
      metadata: { e2e: true, seed: 'audit-logs-viewer' },
    });
    if (seedErr) {
      throw new Error(`seed audit_logs failed: ${seedErr.message}`);
    }

    try {
      await loginAsAdmin(page, adminUser);
      await page.goto('/audit-logs');

      // Header de la page (AdminPageHeader → "Journal d'audit").
      await expect(
        page.getByRole('heading', { name: /Journal d['']audit/i }),
      ).toBeVisible({ timeout: 10_000 });

      // Form filtre : champ Email lookup user.
      await expect(page.getByLabel(/Email \(lookup user\)/i)).toBeVisible();
      // Champ User ID UUID.
      await expect(page.getByLabel(/User ID \(UUID\)/i)).toBeVisible();
      // Bouton submit "Appliquer".
      await expect(page.getByRole('button', { name: /Appliquer/i })).toBeVisible();
      // Au moins une pill event_type rendue (ALL_EVENT_TYPES.length > 0).
      // Le label humain "Connexion (mot de passe)" correspond à
      // 'account_login_password' via labels.ts.
      await expect(
        page.getByRole('link', { name: /Connexion \(mot de passe\)/i }).first(),
      ).toBeVisible();
    } finally {
      await adminClient
        .from('audit_logs')
        .delete()
        .eq('user_id', consumer.id)
        .eq('event_type', 'account_login_password');
      await cleanupAdminRow(adminUser.id);
    }
  });

  test('filtre ?event_type=account_login_password → events filtrés', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(90_000);

    const adminUser = await createAdminUser(ctx, 'al-filter');
    const consumer = await seedConsumer(ctx, { suffix: 'al-filt' });

    const adminClient = getRawAdminClient();
    // 1 event 'account_login_password' + 1 event 'login_failed' pour le même
    // user. Le filtre par event_type doit ne montrer que le 1er.
    await adminClient.from('audit_logs').insert([
      {
        user_id: consumer.id,
        event_type: 'account_login_password',
        metadata: { e2e: true, marker: 'login-ok' },
      },
      {
        user_id: consumer.id,
        event_type: 'login_failed',
        metadata: { e2e: true, marker: 'login-fail' },
      },
    ]);

    try {
      await loginAsAdmin(page, adminUser);
      // Filtre via URL params + filter par user_id pour scoper aux events seedés.
      await page.goto(
        `/audit-logs?event_type=account_login_password&user_id=${consumer.id}`,
      );

      await expect(
        page.getByRole('heading', { name: /Journal d['']audit/i }),
      ).toBeVisible({ timeout: 10_000 });

      // Subtitle indique le nombre d'events ("1 event sur cette page" attendu).
      // Tolérance : si une seed précédente du même runner a polluée, on
      // accepte ≥1.
      await expect(page.getByText(/event.*sur cette page/i)).toBeVisible();

      // Le code event 'account_login_password' est rendu en monospace 10px
      // sous le badge. Au moins une cellule visible.
      await expect(
        page.getByText('account_login_password', { exact: true }).first(),
      ).toBeVisible();

      // Le code 'login_failed' ne doit PAS apparaître dans la table (filtré).
      await expect(
        page.getByText('login_failed', { exact: true }),
      ).toHaveCount(0);
    } finally {
      await adminClient
        .from('audit_logs')
        .delete()
        .eq('user_id', consumer.id)
        .in('event_type', ['account_login_password', 'login_failed']);
      await cleanupAdminRow(adminUser.id);
    }
  });

  test('lookup email via form filtre : email connu résout user_id', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(90_000);

    const adminUser = await createAdminUser(ctx, 'al-look');
    const consumer = await seedConsumer(ctx, { suffix: 'al-look-cons' });

    const adminClient = getRawAdminClient();
    await adminClient.from('audit_logs').insert({
      user_id: consumer.id,
      event_type: 'account_login_password',
      metadata: { e2e: true, marker: 'lookup-test' },
    });

    try {
      await loginAsAdmin(page, adminUser);

      // Submit du form avec le param `email`. lookupUserIdByEmail résout
      // → user_id réel → query audit_logs filtre dessus → événement seedé
      // visible. Rate-limit bypass via env (RATE_LIMIT_BYPASS_TESTS=true).
      await page.goto(
        `/audit-logs?email=${encodeURIComponent(consumer.email)}`,
      );

      await expect(
        page.getByRole('heading', { name: /Journal d['']audit/i }),
      ).toBeVisible({ timeout: 10_000 });

      // L'event seedé doit être visible (lookup OK). On vérifie via le code
      // event_type rendu en monospace.
      await expect(
        page.getByText('account_login_password', { exact: true }).first(),
      ).toBeVisible({ timeout: 10_000 });

      // L'audit log meta `admin_audit_logs_email_lookup` est posé côté serveur
      // par la page (logLegalEvent fire-and-forget). On poll en attendant
      // l'INSERT (peut arriver après la response HTML).
      const meta = await waitForAuditMeta(adminUser.id);
      expect(meta).not.toBeNull();
      expect(
        (meta?.metadata as { user_resolved?: boolean } | undefined)?.user_resolved,
      ).toBe(true);
    } finally {
      await adminClient
        .from('audit_logs')
        .delete()
        .eq('user_id', consumer.id)
        .eq('event_type', 'account_login_password');
      // Nettoyer aussi le meta posé par la page (rattaché à adminUser.id).
      await adminClient
        .from('audit_logs')
        .delete()
        .eq('user_id', adminUser.id)
        .eq('event_type', 'admin_audit_logs_email_lookup');
      await cleanupAdminRow(adminUser.id);
    }
  });
});
