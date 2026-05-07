/**
 * E2E admin — /gestion-producteurs (liste + filtres + invite).
 *
 * Couverture (3 tests) :
 *   1. Page rendue avec un producer seedé visible (status 'public') +
 *      filtres tabs présents (Tous / À valider / Actifs / Suspendus).
 *   2. Filtre "À valider" (= statut 'pending') affiche le producer pending
 *      seedé et masque le producer 'public' seedé.
 *   3. POST /api/admin/producers/invite via UI admin → email captured via
 *      RESEND_TEST_MODE (template 'producer_invitation') + INSERT
 *      producer_invitations row. Test SKIPPED si OPT_OUT_TOKEN_SECRET
 *      absent du .env.local local (la route throw au generateOptOutToken).
 *
 * NB : les routes admin sont à la racine (`/gestion-producteurs`), pas
 * sous `/admin/*` (cf. middleware + layout.tsx host-check production-only).
 */

import { test, expect } from '../helpers/test-context';
import { seedProducer } from '../helpers/db-seed';
import { generateTestEmail } from '../helpers/guards';
import { waitForCapturedEmail } from '../helpers/mailbox';
import { getRawAdminClient } from '../helpers/supabase-admin';
import { createAdminUser, cleanupAdminRow, loginAsAdmin } from './_helpers';

test.describe('Admin — Gestion producteurs', () => {
  test('liste producteurs : page rend tabs filtres + producer public visible', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(90_000);

    const adminUser = await createAdminUser(ctx, 'pl-list');
    const producerPublic = await seedProducer(ctx, {
      suffix: 'pl-public',
      statut: 'public',
      nomExploitation: `Test Producer Public ${Date.now()}`,
    });

    try {
      await loginAsAdmin(page, adminUser);
      await page.goto('/gestion-producteurs');

      // Header de la page
      await expect(
        page.getByRole('heading', { name: /Gestion des producteurs/i }),
      ).toBeVisible({ timeout: 10_000 });

      // Tabs filtres (FilterTabs rendus comme <button> avec count inline,
      // ex: "Tous 10", "À valider 2", "Actifs 8", "Suspendus 0").
      await expect(
        page.getByRole('button', { name: /^Tous(\s+\d+)?$/ }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: /^Actifs(\s+\d+)?$/ }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: /^À valider(\s+\d+)?$/ }),
      ).toBeVisible();

      // Lookup nom_exploitation via service_role (TestProducer ne l'expose pas).
      const { data: producerRow } = await getRawAdminClient()
        .from('producers')
        .select('nom_exploitation')
        .eq('id', producerPublic.producerId)
        .single();
      const nomExploitation = (producerRow?.nom_exploitation as string | undefined) ?? '';

      // Le producer seedé doit apparaître dans la table (filtre 'all' par défaut
      // → status 'public' inclus dans matchesFilter('all', 'public')).
      await expect(
        page.getByText(nomExploitation, { exact: false }).first(),
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await cleanupAdminRow(adminUser.id);
    }
  });

  test('filtre "À valider" affiche pending et masque public', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(90_000);

    const adminUser = await createAdminUser(ctx, 'pl-filt');
    const ts = Date.now();
    const nomPending = `Test Producer Pending ${ts}`;
    const nomPublic = `Test Producer Pub ${ts}`;

    const producerPending = await seedProducer(ctx, {
      suffix: 'pl-pending',
      statut: 'public', // seedProducer ne whitelist pas 'pending'
      nomExploitation: nomPending,
    });
    // Force statut='pending' via service_role (le seed ne le permet pas).
    const adminClient = getRawAdminClient();
    await adminClient
      .from('producers')
      .update({ statut: 'pending' })
      .eq('id', producerPending.producerId);

    await seedProducer(ctx, {
      suffix: 'pl-pub',
      statut: 'public',
      nomExploitation: nomPublic,
    });

    try {
      await loginAsAdmin(page, adminUser);
      await page.goto('/gestion-producteurs');

      // Cliquer le tab "À valider" (FilterTabs : button avec label).
      await page.getByRole('button', { name: /À valider/i }).click();

      // Le producer pending doit être visible…
      await expect(
        page.getByText(nomPending, { exact: false }).first(),
      ).toBeVisible({ timeout: 10_000 });

      // …et le producer public doit être absent (filtré).
      await expect(
        page.getByText(nomPublic, { exact: false }),
      ).toHaveCount(0);
    } finally {
      await cleanupAdminRow(adminUser.id);
    }
  });

  test('admin POST /api/admin/producers/invite → email captured + invitation row', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(90_000);

    // ENV PRÉ-REQUIS NON SETUP : la route POST /api/admin/producers/invite
    // appelle generateOptOutToken() qui throw si OPT_OUT_TOKEN_SECRET absent
    // de l'env (cf. lib/rgpd/opt-out-token.ts:17). Le secret n'est pas posé
    // dans .env.local local (vérifié 2026-05-07 worktree). Test contractuel
    // skippé tant que la var n'est pas ajoutée — le code décrit l'attendu.
    test.skip(
      !process.env.OPT_OUT_TOKEN_SECRET,
      'OPT_OUT_TOKEN_SECRET absent du .env.local — route POST invite throw avant insert. ' +
      'Backlog : ajouter la var en local pour activer le test (cohérent skip onboarding-flow #1).',
    );

    const adminUser = await createAdminUser(ctx, 'pl-invite');
    const inviteeEmail = generateTestEmail('pl-invitee');

    try {
      await loginAsAdmin(page, adminUser);

      const response = await page.request.post('/api/admin/producers/invite', {
        data: { email: inviteeEmail },
      });
      expect(
        response.status(),
        `invite POST body: ${await response.text()}`,
      ).toBe(200);
      const body = (await response.json()) as {
        url: string;
        email_sent: boolean;
      };
      expect(body.email_sent).toBe(true);
      expect(body.url).toContain('/invitation?token=');

      // DB : invitation row insérée
      const adminClient = getRawAdminClient();
      const { data: inv } = await adminClient
        .from('producer_invitations')
        .select('id, email, token, used_at')
        .eq('email', inviteeEmail)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      expect(inv).not.toBeNull();
      expect(inv!.used_at).toBeNull();

      // Email capturé via RESEND_TEST_MODE
      const captured = await waitForCapturedEmail(ctx, {
        to: inviteeEmail,
        template: 'producer_invitation',
        timeoutMs: 15_000,
      });
      expect(captured.html ?? '').toContain('/invitation?token=');

      // Cleanup résiduel : invitation row
      await adminClient.from('producer_invitations').delete().eq('id', inv!.id);
    } finally {
      await cleanupAdminRow(adminUser.id);
    }
  });
});
