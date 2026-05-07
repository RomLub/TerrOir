/**
 * E2E producer — Flow invitation producteur (admin invite → page invitation
 * /[token] → création de compte producer.statut='draft').
 *
 * Couverture (5 tests) :
 *   1. Admin invite via POST /api/admin/producers/invite → INSERT
 *      producer_invitations + email captured (template producer_invitation)
 *      contenant le lien token.
 *   2. Producer clique le lien /invitation?token=... → page rendue avec le
 *      wizard step=1 (création compte) + email pré-rempli readonly.
 *   3. Token expiré (expires_at < now) → ErrorCard "Invitation expirée"
 *      visible, pas de wizard.
 *   4. Token already used (used_at NOT NULL) → ErrorCard "déjà utilisée".
 *   5. Token introuvable → ErrorCard "introuvable".
 *
 * Dépendances cluster :
 *   - admin créé via auth.admin.createUser + INSERT admin_users.user_id.
 *     Pas de helper seed admin disponible — on crée à la volée dans le test
 *     #1 et on track le user via ctx pour cleanup auto.
 *   - sendTemplate('producer_invitation') alimente test_emails_captured
 *     côté serveur quand RESEND_TEST_MODE=true. waitForCapturedEmail
 *     applique l'allow-list email + filtre by template.
 */

import { test, expect } from '../helpers/test-context';
import { createTestUser } from '../helpers/user-lifecycle';
import { generateTestEmail } from '../helpers/guards';
import { waitForCapturedEmail } from '../helpers/mailbox';
import {
  getRawAdminClient,
  trackUserId,
  trackRowId,
} from '../helpers/supabase-admin';

const STRONG_PASSWORD = 'Aa1' + 'ZZzz9999PpQq';

/**
 * Crée un user, lui ajoute l'entrée admin_users.user_id (= flag isAdmin
 * côté getSessionUser) et bypass le login UI en s'appuyant sur le helper
 * loginAs côté CALLER. Ici on retourne juste l'user créé.
 */
async function createAdminUser(ctx: import('../helpers/supabase-admin').TestContext) {
  const user = await createTestUser(ctx, { suffix: 'invadm' });
  const admin = getRawAdminClient();
  const { data: adminRow, error } = await admin
    .from('admin_users')
    .insert({ user_id: user.id })
    .select('user_id')
    .single();
  if (error || !adminRow) {
    throw new Error(`createAdminUser INSERT admin_users: ${error?.message}`);
  }
  return user;
}

test.describe('Producer onboarding — invitation flow', () => {
  test('admin POST /api/admin/producers/invite → email captured + invitation row', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(90_000);

    const adminUser = await createAdminUser(ctx);
    const inviteeEmail = generateTestEmail('invitee-happy');

    // Login UI admin (pose les cookies session pour que getSessionUser()
    // côté route POST détecte session.isAdmin=true).
    await page.goto('/connexion');
    await page.getByLabel('Email', { exact: true }).fill(adminUser.email);
    await page.getByLabel('Mot de passe', { exact: true }).fill(adminUser.password);
    await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/connexion'));

    const response = await page.request.post('/api/admin/producers/invite', {
      data: { email: inviteeEmail },
    });
    expect(response.status(), `invite POST body: ${await response.text()}`).toBe(200);
    const body = (await response.json()) as {
      url: string;
      expires_at: string;
      email_sent: boolean;
    };
    expect(body.email_sent).toBe(true);
    expect(body.url).toContain('/invitation?token=');

    // DB : invitation row insérée
    const adminClient = getRawAdminClient();
    const { data: inv } = await adminClient
      .from('producer_invitations')
      .select('id, email, token, used_at, expires_at')
      .eq('email', inviteeEmail)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(inv, `producer_invitations row pour ${inviteeEmail}`).not.toBeNull();
    expect(inv!.used_at).toBeNull();

    // Email capturé via RESEND_TEST_MODE
    const captured = await waitForCapturedEmail(ctx, {
      to: inviteeEmail,
      template: 'producer_invitation',
      timeoutMs: 15_000,
    });
    expect(captured.html, 'invitation email html').toBeTruthy();
    // Le lien d'invitation contient le token (pré-fixe URL pro.<host>).
    expect(captured.html ?? '').toContain('/invitation?token=');
    expect(captured.html ?? '').toContain(inv!.token as string);

    // Cleanup résiduels invitation row (FK indépendante de auth.users —
    // pas cascade depuis admin user). Tracking ici pour ne pas polluer.
    await adminClient.from('producer_invitations').delete().eq('id', inv!.id);
  });

  test('GET /invitation?token=valide → wizard rendu avec email pré-rempli readonly', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    // Setup direct DB : on insère une invitation valide sans passer par
    // l'admin (test isolé du flow d'envoi). expires_at = +7j default
    // côté table.
    const inviteeEmail = generateTestEmail('invitee-page');
    const token = 'pwtest_' + Math.random().toString(36).slice(2) +
      Math.random().toString(36).slice(2);

    const adminClient = getRawAdminClient();

    // Pour created_by NOT NULL, on crée un admin éphémère.
    const adminUser = await createAdminUser(ctx);

    const { data: inv, error: invErr } = await adminClient
      .from('producer_invitations')
      .insert({
        email: inviteeEmail,
        token,
        created_by: adminUser.id,
      })
      .select('id, token')
      .single();
    if (invErr || !inv) {
      throw new Error(`Setup invitation row failed: ${invErr?.message}`);
    }

    try {
      await page.goto(`/invitation?token=${inv.token}`);
      // Le wizard contient un input email readonly avec value=email
      await expect(page.getByText('Bienvenue sur TerrOir')).toBeVisible();
      await expect(page.getByText(inviteeEmail)).toBeVisible();
      // Step 1 wizard "Créer mon compte" doit être visible (caseKind='new')
      await expect(
        page.getByRole('button', { name: 'Créer mon compte', exact: true }),
      ).toBeVisible();
    } finally {
      await adminClient.from('producer_invitations').delete().eq('id', inv.id);
    }
  });

  test('GET /invitation?token=expiré → ErrorCard "expirée", pas de wizard', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const adminUser = await createAdminUser(ctx);
    const inviteeEmail = generateTestEmail('invitee-expired');
    const token = 'pwexp_' + Math.random().toString(36).slice(2) +
      Math.random().toString(36).slice(2);

    const adminClient = getRawAdminClient();
    const pastIso = new Date(Date.now() - 60_000).toISOString();
    const { data: inv, error: invErr } = await adminClient
      .from('producer_invitations')
      .insert({
        email: inviteeEmail,
        token,
        created_by: adminUser.id,
        expires_at: pastIso,
      })
      .select('id, token')
      .single();
    if (invErr || !inv) {
      throw new Error(`Setup expired invitation: ${invErr?.message}`);
    }

    try {
      await page.goto(`/invitation?token=${inv.token}`);
      await expect(page.getByRole('heading', { name: /Invitation invalide/i })).toBeVisible();
      await expect(page.getByText(/expirée/i)).toBeVisible();
      // Le wizard ne doit PAS être rendu
      await expect(
        page.getByRole('button', { name: 'Créer mon compte', exact: true }),
      ).toHaveCount(0);
    } finally {
      await adminClient.from('producer_invitations').delete().eq('id', inv.id);
    }
  });

  test('GET /invitation?token=déjà-utilisé → ErrorCard "déjà utilisée"', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const adminUser = await createAdminUser(ctx);
    const inviteeEmail = generateTestEmail('invitee-used');
    const token = 'pwused_' + Math.random().toString(36).slice(2) +
      Math.random().toString(36).slice(2);

    const adminClient = getRawAdminClient();
    const { data: inv, error: invErr } = await adminClient
      .from('producer_invitations')
      .insert({
        email: inviteeEmail,
        token,
        created_by: adminUser.id,
        used_at: new Date().toISOString(),
      })
      .select('id, token')
      .single();
    if (invErr || !inv) {
      throw new Error(`Setup used invitation: ${invErr?.message}`);
    }

    try {
      await page.goto(`/invitation?token=${inv.token}`);
      await expect(page.getByRole('heading', { name: /Invitation invalide/i })).toBeVisible();
      await expect(page.getByText(/déjà utilisée/i)).toBeVisible();
    } finally {
      await adminClient.from('producer_invitations').delete().eq('id', inv.id);
    }
  });

  test('GET /invitation?token=introuvable → ErrorCard "introuvable"', async ({
    page,
  }) => {
    test.setTimeout(30_000);
    // Token bidon non présent en DB
    const fakeToken = 'pwnotfound_' + 'x'.repeat(60);
    await page.goto(`/invitation?token=${fakeToken}`);
    await expect(page.getByRole('heading', { name: /Invitation invalide/i })).toBeVisible();
    await expect(page.getByText(/introuvable/i)).toBeVisible();
  });
});
