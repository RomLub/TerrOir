/**
 * E2E producer — Multistep onboarding wizard StepInfos.
 *
 * Chantier 3 (2026-05-22) : les indicateurs score-carbone + la déclaration de
 * véracité DGCCRF ont été supprimés du formulaire. Le wizard ne collecte plus
 * que les champs business de l'exploitation.
 *
 * Couverture (1 test) :
 *   - Submit happy path : remplissage des champs business → la RPC
 *     update_producer_onboarding bascule le producteur draft → pending et
 *     redirige vers /ma-page.
 */

import { test, expect } from '../helpers/test-context';
import { generateTestEmail } from '../helpers/guards';
import {
  getRawAdminClient,
  type TestContext,
} from '../helpers/supabase-admin';

const STRONG_PASSWORD = 'Aa1' + 'XR5tq8ZpL3vBn';

/**
 * Crée un user admin (auth.users + admin_users) directement via service_role.
 * Bypass createTestUser : ce dernier INSERT public.users qui déclenche le
 * trigger d'exclusivité users<->admin_users (cf. migration 20260421100000).
 * admin_users.id (pas user_id) référence auth.users(id).
 */
async function createAdminUser(ctx: TestContext) {
  const email = generateTestEmail('mult-adm');
  const admin = getRawAdminClient();
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: STRONG_PASSWORD,
    email_confirm: true,
  });
  if (createErr || !created.user) {
    throw new Error(`createAdminUser auth.admin.createUser: ${createErr?.message}`);
  }
  ctx.trackedUserIds.add(created.user.id);
  ctx.trackedEmails.add(email);

  const { error: insErr } = await admin
    .from('admin_users')
    .insert({ id: created.user.id, email });
  if (insErr) {
    throw new Error(`createAdminUser admin_users insert: ${insErr.message}`);
  }
  return { id: created.user.id, email, password: STRONG_PASSWORD };
}

/**
 * Setup helper : crée un user invité loggé sur la page /invitation à
 * l'étape StepInfos (le wizard passe à l'étape 2 via useEffect onSuccess
 * du formulaire create-account).
 *
 * Re-architecture Phase 3 (cycle qualité totale 07/05) : l'ancien helper
 * faisait `auth.admin.listUsers({ perPage: 200 })` après la création UI
 * pour retrouver l'id de l'user créé par createAccountAction. Cette
 * approche déclenchait un timing race (eventual consistency listUsers)
 * et finissait souvent par throw "Created user introuvable".
 *
 * Nouvelle stratégie : la server action `createAccountAction` insère
 * synchronously une ligne dans `public.users` avec id = auth.users.id
 * (cf. create-account.ts:92-96). On lit cette ligne via service_role
 * filtrée par email — déterministe, pas de listUsers, pas de paging.
 */
async function setupDraftProducerSession(
  page: import('@playwright/test').Page,
  ctx: TestContext,
  suffix: string,
) {
  const adminUser = await createAdminUser(ctx);
  const inviteeEmail = generateTestEmail(suffix);
  const token = 'pwms_' + Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2);
  const admin = getRawAdminClient();

  // INSERT invitation (created_by NOT NULL via admin user)
  const { data: inv, error: invErr } = await admin
    .from('producer_invitations')
    .insert({ email: inviteeEmail, token, created_by: adminUser.id })
    .select('id, token')
    .single();
  if (invErr || !inv) throw new Error(`invitation insert: ${invErr?.message}`);

  // Création du compte via UI (StepCompteNew → createAccountAction).
  // L'action crée auth.users + INSERT public.users + INSERT producers
  // + signInWithPassword (cookies session). Sur succès elle return
  // { success: true } → useEffect onSuccess() bascule le wizard step→2.
  await page.goto(`/invitation?token=${inv.token}`);
  // Refonte funnel : l'identité (perso) est saisie à l'étape « compte »
  // (StepCompteNew), plus à l'étape 2.
  await page.getByLabel('Prénom', { exact: true }).fill('Test');
  await page.getByLabel('Nom', { exact: true }).fill('Producer');
  await page.getByLabel('Téléphone', { exact: true }).fill('0612345678');
  await page.getByLabel('Mot de passe', { exact: true }).fill(STRONG_PASSWORD);
  await page.getByLabel('Confirmer le mot de passe', { exact: true }).fill(STRONG_PASSWORD);
  await page.getByRole('button', { name: 'Créer mon compte', exact: true }).click();

  // Attendre que StepInfos soit monté (étape 2). Marqueur stable :
  // input[name="nom_exploitation"] présent dans StepInfos uniquement.
  // Pattern Phase 1 : les <label> de StepInfos sont siblings sans htmlFor,
  // donc getByLabel() ne fonctionne pas — fallback locator par name.
  await expect(page.locator('input[name="nom_exploitation"]')).toBeVisible({ timeout: 20_000 });

  // Lookup id via public.users (id = auth.users.id, INSERT synchrone
  // dans createAccountAction). Pas de listUsers — pas de race timing.
  const { data: userRow, error: userErr } = await admin
    .from('users')
    .select('id')
    .eq('email', inviteeEmail)
    .maybeSingle();
  if (userErr) {
    throw new Error(`setupDraftProducerSession lookup users: ${userErr.message}`);
  }
  if (!userRow?.id) {
    throw new Error(
      `setupDraftProducerSession: public.users row absente pour ${inviteeEmail} ` +
        `(createAccountAction n'a pas terminé l'INSERT users — investigate)`,
    );
  }

  // Track for cleanup
  ctx.trackedUserIds.add(userRow.id as string);
  ctx.trackedEmails.add(inviteeEmail);

  return {
    userId: userRow.id as string,
    email: inviteeEmail,
    invitationId: inv.id,
    token: inv.token,
  };
}

async function deleteInvitation(invitationId: string) {
  const admin = getRawAdminClient();
  await admin.from('producer_invitations').delete().eq('id', invitationId);
}

// Phase 3 cycle qualité totale (07/05) : helper setupDraftProducerSession
// re-architecturé pour ne plus utiliser auth.admin.listUsers (race timing).
// Le route group bug P1 a été résolu en Phase 1 (déplacement /invitation
// vers (public) — cf. app/(public)/invitation/page.tsx). Les 3 tests
// ci-dessous sont maintenant exécutés.
test.describe('Producer onboarding — multistep StepInfos', () => {
  test('submit happy path → statut draft devient pending + redirect /ma-page', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(120_000);

    const { userId, invitationId } = await setupDraftProducerSession(page, ctx, 'submit');

    try {
      // Remplir tous les champs business requis. Pattern : on utilise des
      // locators par name= car les <label> de StepInfos sont siblings sans
      // htmlFor association — getByLabel() retourne 0 element.
      // Étape 2 = exploitation uniquement (le perso a été saisi à l'étape 1).
      await page.locator('input[name="nom_exploitation"]').fill('Ferme Playwright');
      await page.locator('select[name="forme_juridique"]').selectOption('ei');
      await page.locator('input[name="siret"]').fill('12345678901234');
      await page.locator('input[name="adresse"]').fill('1 rue du Test');
      await page.locator('input[name="code_postal"]').fill('72000');
      // La commune est désormais un <select> alimenté par le code postal
      // (CommuneSelect partagé). selectOption auto-attend l'option chargée.
      await page.locator('select[name="commune"]').selectOption('Le Mans');
      await page.locator('select[name="type_production"]').selectOption('elevage');

      await page.getByRole('button', { name: /Finaliser ma demande/i }).click();

      // Redirect vers /ma-page?onboarded=1 attendu (revalidatePath +
      // redirect côté server action). On vise un marqueur d'URL.
      await page.waitForURL(/\/ma-page/, { timeout: 30_000 });

      const admin = getRawAdminClient();
      const { data: prod, error: prodErr } = await admin
        .from('producers')
        .select('statut, nom_exploitation')
        .eq('user_id', userId)
        .maybeSingle();
      expect(prodErr, prodErr?.message).toBeNull();
      expect(prod, 'producer row introuvable').not.toBeNull();

      // statut bascule de 'draft' → 'pending' (RPC update_producer_onboarding)
      expect(prod!.statut).toBe('pending');
      expect(prod!.nom_exploitation).toBe('Ferme Playwright');
    } finally {
      await deleteInvitation(invitationId);
    }
  });
});
