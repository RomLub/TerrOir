/**
 * E2E admin — Recherche consumers par email.
 *
 * NB IMPORTANT — recherche admin consumers : la codebase TerrOir n'a PAS
 * de page admin dédiée /admin/consumers/search. La surface de recherche
 * email→user_id la plus proche est /audit-logs avec son champ "Email
 * (lookup user)" qui passe par lib/audit-logs/email-lookup.ts (T-083) :
 *
 *   - Lookup case-insensitive via .ilike(escapeIlikeEmail(...)) (T-110/110-bis)
 *   - Sentinel SENTINEL_NOT_FOUND_USER_ID sur miss (anti-énumération)
 *   - Rate-limit 30/min/admin (getAuditLogsEmailLookupRateLimit)
 *   - Audit log meta `admin_audit_logs_email_lookup` à chaque appel
 *
 * Couverture (2 tests) :
 *   1. Recherche par email → audit log meta `admin_audit_logs_email_lookup`
 *      enregistré avec masked_email + user_resolved=true.
 *   2. Recherche email inconnu → audit log meta avec user_resolved=false
 *      (sentinel UUID), aucun event utilisateur résolu côté tableau (UI
 *      uniforme anti-énumération).
 *
 * Backlog : si une page admin /consumers dédiée est créée plus tard avec
 * détail orders + dépenses totales, ajouter un 3e test ici.
 */

import { test, expect } from '../helpers/test-context';
import { seedConsumer } from '../helpers/db-seed';
import { generateTestEmail } from '../helpers/guards';
import { getRawAdminClient } from '../helpers/supabase-admin';
import { createAdminUser, cleanupAdminRow, loginAsAdmin } from './_helpers';

/**
 * Polling : la page /audit-logs émet le meta via fire-and-forget
 * `void logLegalEvent(...)` côté serveur — la response HTML peut être
 * renvoyée avant que l'INSERT soit committed. On poll jusqu'à voir la row.
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

test.describe('Admin — Recherche consumers (email lookup)', () => {
  test('recherche email connu → audit log meta avec user_resolved=true', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(90_000);

    const adminUser = await createAdminUser(ctx, 'cs-known');
    const consumer = await seedConsumer(ctx, { suffix: 'cs-known' });

    const adminClient = getRawAdminClient();

    try {
      await loginAsAdmin(page, adminUser);

      await page.goto(
        `/audit-logs?email=${encodeURIComponent(consumer.email)}`,
      );

      await expect(
        page.getByRole('heading', { name: /Journal d['']audit/i }),
      ).toBeVisible({ timeout: 10_000 });

      // Audit log meta `admin_audit_logs_email_lookup` posé par la page
      // (logLegalEvent fire-and-forget). On poll pour absorber l'éventuel
      // décalage response HTML / INSERT committed.
      const meta = await waitForAuditMeta(adminUser.id);
      expect(meta).not.toBeNull();
      const md = (meta?.metadata as
        | { user_resolved?: boolean; masked_email?: string; rate_limited?: boolean }
        | undefined) ?? {};
      expect(md.user_resolved).toBe(true);
      // masked_email : préserve le domaine, masque le local-part (cf.
      // maskEmail logic). Format attendu : "p***@mailinator.com".
      expect(md.masked_email).toMatch(/^p\*\*\*@mailinator\.com$/);
      // Pas de rate-limit attendu (1er appel, et bypass si Upstash absent).
      expect(md.rate_limited).toBe(false);
    } finally {
      await adminClient
        .from('audit_logs')
        .delete()
        .eq('user_id', adminUser.id)
        .eq('event_type', 'admin_audit_logs_email_lookup');
      await cleanupAdminRow(adminUser.id);
    }
  });

  test('recherche email inconnu → user_resolved=false + UI uniforme', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const adminUser = await createAdminUser(ctx, 'cs-unkn');
    // Email valide RFC mais jamais inséré en DB. Pattern allow-list pour
    // que assertSafeEmail soit OK si le email touch un guard quelque part.
    const unknownEmail = generateTestEmail('cs-unknown-' + Date.now());

    const adminClient = getRawAdminClient();

    try {
      await loginAsAdmin(page, adminUser);

      await page.goto(
        `/audit-logs?email=${encodeURIComponent(unknownEmail)}`,
      );

      await expect(
        page.getByRole('heading', { name: /Journal d['']audit/i }),
      ).toBeVisible({ timeout: 10_000 });

      // Le tableau doit afficher "Aucun event trouvé" (sentinel filter →
      // 0 rows) — réponse uniforme avec un email inconnu (anti-oracle).
      await expect(
        page.getByText(/Aucun event trouvé/i),
      ).toBeVisible({ timeout: 5_000 });

      // Audit log meta posé même pour un miss (forensique : l'admin a
      // tenté un lookup, on trace). Poll pour absorber le délai INSERT.
      const meta = await waitForAuditMeta(adminUser.id);
      expect(meta).not.toBeNull();
      const md = (meta?.metadata as
        | { user_resolved?: boolean; masked_email?: string }
        | undefined) ?? {};
      expect(md.user_resolved).toBe(false);
      expect(md.masked_email).toMatch(/^p\*\*\*@mailinator\.com$/);
    } finally {
      await adminClient
        .from('audit_logs')
        .delete()
        .eq('user_id', adminUser.id)
        .eq('event_type', 'admin_audit_logs_email_lookup');
      await cleanupAdminRow(adminUser.id);
    }
  });
});
