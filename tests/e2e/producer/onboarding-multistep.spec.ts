/**
 * E2E producer — Multistep onboarding wizard StepInfos (déclaration véracité
 * T-241 + T-282).
 *
 * Note doctrine TerrOir : DECLARATION_VERACITE_WORDING_VERSION = 'v1.0'
 * actuellement en production (cf. lib/producers/declaration-veracite.ts).
 * Le brief mentionne 'v1.1' mais le code source pointe sur v1.0 — on
 * teste la version courante telle qu'exposée par helper
 * getDeclarationVeraciteText() (single source of truth runtime). Si bump
 * v1.1 est livré, le test continuera de matcher car on lit la version
 * vivante.
 *
 * Couverture (3 tests) :
 *   1. Affichage wording courant : la page /invitation rend le texte exact
 *      de la version courante (single source helper).
 *   2. Submit happy path avec déclaration → producers.declaration_*
 *      colonnes persistées (wording_version + at NOT NULL + snapshot).
 *   3. Submit avec enums score-carbone non cochée → erreur Zod
 *      "certifie qu'ils correspondent" sur le champ veracite (refine
 *      conditionnel cf. validators.ts).
 */

import { test, expect } from '../helpers/test-context';
import { generateTestEmail } from '../helpers/guards';
import {
  getRawAdminClient,
  type TestContext,
} from '../helpers/supabase-admin';

// Doctrine T-241 : on duplique ici les valeurs probatoires du wording
// certifié pour éviter un import cross-package (@/lib/...) depuis un
// fichier .spec.ts Playwright. Si le helper côté lib bump (v1.0 → v1.1+),
// ce test devient un signal contractuel : il échouera et forcera la
// mise à jour intentionnelle. Vérité runtime reste lib/producers/
// declaration-veracite.ts (single source of truth).
const EXPECTED_WORDING_VERSION = 'v1.0';
const EXPECTED_WORDING_TEXT_PREFIX =
  'Je certifie que les indicateurs déclarés';

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
test.describe('Producer onboarding — multistep StepInfos + déclaration véracité', () => {
  test('affiche le wording certifié de la version courante (single source)', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(90_000);

    const { invitationId } = await setupDraftProducerSession(page, ctx, 'wording');

    try {
      // Le label de la checkbox certification doit contenir le texte exact
      // exposé par getDeclarationVeraciteText() côté UI (lib/producers/
      // declaration-veracite.ts). Test contractuel : si version bump,
      // mettre à jour EXPECTED_WORDING_TEXT_PREFIX intentionnellement.
      await expect(
        page.getByText(EXPECTED_WORDING_TEXT_PREFIX, { exact: false }),
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await deleteInvitation(invitationId);
    }
  });

  test('submit happy path avec déclaration cochée → DB persiste wording_version + snapshot', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(120_000);

    const { userId, invitationId } = await setupDraftProducerSession(page, ctx, 'submit');

    try {
      // Remplir tous les champs business requis. Pattern : on utilise des
      // locators par name= car les <label> de StepInfos sont siblings sans
      // htmlFor association — getByLabel() retourne 0 element.
      await page.locator('input[name="prenom"]').fill('Test');
      await page.locator('input[name="nom"]').fill('Producer');
      await page.locator('input[name="telephone"]').fill('0612345678');
      await page.locator('input[name="nom_exploitation"]').fill('Ferme Playwright');
      await page.locator('select[name="forme_juridique"]').selectOption('ei');
      await page.locator('input[name="siret"]').fill('12345678901234');
      await page.locator('input[name="adresse"]').fill('1 rue du Test');
      await page.locator('input[name="code_postal"]').fill('72000');
      await page.locator('input[name="commune"]').fill('Le Mans');
      await page.locator('select[name="type_production"]').selectOption('elevage');

      // Cocher au moins 1 enum score-carbone (déclenche refine veracite)
      await page.locator('input[name="mode_elevage"]').first().check();
      // Cocher la déclaration véracité
      await page.locator('input[name="declaration_indicateurs_veracite"]').check();

      await page.getByRole('button', { name: /Finaliser ma demande/i }).click();

      // Redirect vers /ma-page?onboarded=1 attendu (revalidatePath +
      // redirect côté server action). On vise un marqueur d'URL.
      await page.waitForURL(/\/ma-page/, { timeout: 30_000 });

      // DB assertions : producers.declaration_indicateurs_*
      const admin = getRawAdminClient();
      const { data: prod, error: prodErr } = await admin
        .from('producers')
        .select(
          'statut, declaration_indicateurs_wording_version, declaration_indicateurs_veracite_at, declaration_indicateurs_snapshot, mode_elevage',
        )
        .eq('user_id', userId)
        .maybeSingle();
      expect(prodErr, prodErr?.message).toBeNull();
      expect(prod, 'producer row introuvable').not.toBeNull();

      // statut bascule de 'draft' → 'pending' (RPC update_producer_onboarding)
      expect(prod!.statut).toBe('pending');
      // wording_version doit matcher la version courante archivée
      expect(prod!.declaration_indicateurs_wording_version).toBe(
        EXPECTED_WORDING_VERSION,
      );
      // timestamp horodatage présent
      expect(prod!.declaration_indicateurs_veracite_at).not.toBeNull();
      // snapshot reflète au moins 1 enum non NULL (mode_elevage choisi)
      expect(prod!.mode_elevage).not.toBeNull();
      const snapshot = prod!.declaration_indicateurs_snapshot as Record<string, unknown> | null;
      expect(snapshot).not.toBeNull();
    } finally {
      await deleteInvitation(invitationId);
    }
  });

  test('submit avec enum coché mais déclaration NON cochée → erreur Zod refine', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(120_000);

    const { invitationId } = await setupDraftProducerSession(page, ctx, 'no-decl');

    try {
      // Pattern : locators par name= (cf. test précédent) — labels sans htmlFor.
      await page.locator('input[name="prenom"]').fill('Test');
      await page.locator('input[name="nom"]').fill('Producer');
      await page.locator('input[name="telephone"]').fill('0612345678');
      await page.locator('input[name="nom_exploitation"]').fill('Ferme NoDecl');
      await page.locator('select[name="forme_juridique"]').selectOption('ei');
      await page.locator('input[name="siret"]').fill('12345678901234');
      await page.locator('input[name="adresse"]').fill('2 rue Test');
      await page.locator('input[name="code_postal"]').fill('72000');
      await page.locator('input[name="commune"]').fill('Le Mans');
      await page.locator('select[name="type_production"]').selectOption('elevage');

      // Coche enum SANS cocher la déclaration véracité → Zod refine fail
      await page.locator('input[name="mode_elevage"]').first().check();

      await page.getByRole('button', { name: /Finaliser ma demande/i }).click();

      // Le message d'erreur Zod ancré sur le champ declaration_indicateurs_veracite
      await expect(page.getByText(/certifie qu.ils correspondent/i)).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      await deleteInvitation(invitationId);
    }
  });
});
