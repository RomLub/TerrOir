/**
 * E2E delete-account RGPD (Phase 2 cycle e2e exhaustif).
 *
 * Couvre 2 tests sur la modale DeleteAccountSection (page /compte/profil) :
 *
 *   1. happy path 2-step : login + ouvre modale + saisit password + tape
 *      "SUPPRIMER" → server action deleteAccountAction →
 *      RPC delete_user_account + admin.auth.admin.deleteUser + email
 *      goodbye via sendTemplate template "account_deleted" (capté par
 *      RESEND_TEST_MODE) + redirect vers /. Audit log account_deleted.
 *      Post-flow : auth.users.id supprimé.
 *
 *   2. cancel mid-flow : ouvre modale + clic Annuler → modale fermée
 *      sans mutation. User toujours présent en auth.users + public.users.
 *
 * Server action source : app/(consumer)/compte/profil/delete-account-action.ts
 * UI source : app/(consumer)/compte/profil/_components/DeleteAccountSection.tsx
 *
 * Cleanup : le happy path supprime déjà le user via la RPC + admin.deleteUser.
 * On appelle untrackId pour empêcher cleanupTestUser (afterEach) de re-tenter
 * un delete sur un user déjà disparu (qui throw au step 5 — voir
 * user-lifecycle.ts:200).
 */

import { test, expect } from '../helpers/test-context';
import { createTestUser, loginAs } from '../helpers/user-lifecycle';
import { nowIsoForAudit } from '../helpers/otp-capture';
import {
  getReadOnlyAdminClient,
  untrackId,
} from '../helpers/supabase-admin';
import { waitForCapturedEmail } from '../helpers/mailbox';

test.describe('Delete account RGPD', () => {
  test('happy path 2-step : RPC + email goodbye + redirect home', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(90_000);

    const user = await createTestUser(ctx, { suffix: 'delete-happy' });
    await loginAs(page, user);
    await page.goto('/compte/profil');

    // Attendre que le profil soit chargé : DeleteAccountSection est rendu
    // après le state loading=false (cf. profil/page.tsx). Tant que la page
    // est en "Chargement…", le bouton n'est pas monté.
    await expect(
      page.getByRole('button', { name: 'Supprimer mon compte', exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await page
      .getByRole('button', { name: 'Supprimer mon compte', exact: true })
      .click();

    // Modale apparaît
    await expect(
      page.getByRole('dialog', { name: /Supprimer définitivement ton compte/i }),
    ).toBeVisible();

    const t0 = nowIsoForAudit();
    const requestStartedAt = new Date();

    // Saisit le password puis le texte de confirmation "SUPPRIMER"
    await page.getByLabel('Mot de passe', { exact: true }).fill(user.password);
    await page
      .getByLabel(/Pour confirmer.*tapez/i)
      .fill('SUPPRIMER');

    // Submit "Supprimer définitivement mon compte"
    await page
      .getByRole('button', {
        name: /Supprimer définitivement mon compte/i,
      })
      .click();

    // Écran de transition "Compte supprimé / Redirection en cours…"
    await expect(
      page.getByRole('heading', { name: /Compte supprimé/i }),
    ).toBeVisible({ timeout: 15_000 });

    // Redirect vers / (home) après ~800ms (cf. REDIRECT_DELAY_MS dans
    // DeleteAccountSection.tsx:19)
    await page.waitForURL((url) => url.pathname === '/', { timeout: 10_000 });

    // Audit log account_deleted émis. Le user_id est mis à NULL post-flow
    // par la FK ON DELETE SET NULL (audit_logs.user_id → auth.users.id) une
    // fois que admin.auth.admin.deleteUser a tourné en step 8 du
    // delete-account-action.ts. On ne peut donc pas filtrer par user_id ici
    // (le row existe mais avec user_id=null) — on filtre par event_type +
    // fenêtre temporelle stricte (t0 capturé juste avant le submit).
    const adminAudit = getReadOnlyAdminClient();
    const { data: deletedEvents, error: auditErr } = await adminAudit
      .from('audit_logs')
      .select('event_type, user_id, metadata, created_at')
      .eq('event_type', 'account_deleted')
      .gte('created_at', t0)
      .order('created_at', { ascending: false })
      .limit(5);
    expect(auditErr).toBeNull();
    expect(deletedEvents?.length ?? 0).toBeGreaterThanOrEqual(1);

    // Email goodbye capturé via RESEND_TEST_MODE
    const captured = await waitForCapturedEmail(ctx, {
      to: user.email,
      // Le template name côté sendTemplate est "account_deleted" avec
      // underscore (cf. delete-account-action.ts:222), pas "account-deleted".
      template: 'account_deleted',
      since: requestStartedAt,
      timeoutMs: 10_000,
    });
    expect(captured.template).toBe('account_deleted');
    expect(captured.subject).toMatch(/compte TerrOir.*supprimé/i);
    expect(captured.html ?? '').toMatch(/compte.*supprimé/i);

    // Vérification DB post-flow : auth.users.id N'EXISTE plus
    const admin = getReadOnlyAdminClient();
    const { data: authUserAfter } =
      await admin.auth.admin.getUserById(user.id);
    expect(authUserAfter.user).toBeNull();

    // Idem public.users (CASCADE depuis auth.users)
    const { data: publicUserAfter } = await admin
      .from('users')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();
    expect(publicUserAfter).toBeNull();

    // Untrack le user pour empêcher cleanupTestUser (afterEach) de
    // re-tenter un delete sur un user déjà disparu (auth.admin.deleteUser
    // throw "User not found" → cleanup helper throw cf. user-lifecycle.ts:200).
    untrackId(ctx, user.id);
  });

  test('cancel mid-flow : modale fermée + user intact', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const user = await createTestUser(ctx, { suffix: 'delete-cancel' });
    await loginAs(page, user);
    await page.goto('/compte/profil');

    await expect(
      page.getByRole('button', { name: 'Supprimer mon compte', exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await page
      .getByRole('button', { name: 'Supprimer mon compte', exact: true })
      .click();

    await expect(
      page.getByRole('dialog', { name: /Supprimer définitivement ton compte/i }),
    ).toBeVisible();

    // Clic "Annuler" — bouton type="button" qui appelle onClose
    await page.getByRole('button', { name: 'Annuler', exact: true }).click();

    // Modale n'est plus visible
    await expect(
      page.getByRole('dialog', { name: /Supprimer définitivement ton compte/i }),
    ).not.toBeVisible();

    // User toujours là en auth.users + public.users
    const admin = getReadOnlyAdminClient();
    const { data: authUser } = await admin.auth.admin.getUserById(user.id);
    expect(authUser.user?.id).toBe(user.id);

    const { data: publicUser } = await admin
      .from('users')
      .select('id, email')
      .eq('id', user.id)
      .maybeSingle();
    expect(publicUser?.id).toBe(user.id);
    expect(publicUser?.email).toBe(user.email);
  });
});
