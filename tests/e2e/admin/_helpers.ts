/**
 * Helper local au cluster admin/ — création d'un user admin éphémère via
 * service_role qui contourne `createTestUser` (le helper standard insère
 * dans public.users, ce qui déclenche le trigger d'exclusivité
 * users<->admin_users de la migration 20260421100000 et bloque l'INSERT
 * admin_users en cascade).
 *
 * Pattern réutilisé depuis tests/e2e/producer/onboarding-flow.spec.ts
 * (createAdminUser interne) — le helper global `ensurePersistentUser('admin')`
 * de auth-state.ts est ACTUELLEMENT cassé pour le rôle admin (il INSERT
 * users avant admin_users → trigger exclusion). On garde la version locale
 * jusqu'à correction upstream.
 *
 * Le user créé est tracké dans ctx.trackedUserIds pour permettre le cleanup
 * automatique en afterEach. La ligne admin_users.id est purgée séparément
 * via cleanupAdminRow car cleanupTestUser ne couvre pas cette table.
 */

import type { Page } from '@playwright/test';
import { generateTestEmail } from '../helpers/guards';
import {
  getRawAdminClient,
  trackUserId,
  trackEmail,
  type TestContext,
} from '../helpers/supabase-admin';

const STRONG_PASSWORD = 'Aa1ZZzz9999PpQq';

export interface AdminTestUser {
  id: string;
  email: string;
  password: string;
}

export async function createAdminUser(
  ctx: TestContext,
  suffix = 'admin',
): Promise<AdminTestUser> {
  const email = generateTestEmail(suffix);
  const admin = getRawAdminClient();

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: STRONG_PASSWORD,
    email_confirm: true,
  });
  if (createErr || !created.user) {
    throw new Error(`createAdminUser: auth.admin.createUser: ${createErr?.message}`);
  }
  trackUserId(ctx, created.user.id);
  trackEmail(ctx, email);

  const { error: insErr } = await admin
    .from('admin_users')
    .insert({ id: created.user.id, email });
  if (insErr) {
    throw new Error(`createAdminUser: INSERT admin_users: ${insErr.message}`);
  }

  return { id: created.user.id, email, password: STRONG_PASSWORD };
}

/**
 * Cleanup explicite de admin_users (cleanupTestUser ne couvre pas cette
 * table). À appeler avant la fin du test ou dans un finally — la cascade
 * auth.users → admin_users.id ON DELETE CASCADE devrait déjà nettoyer,
 * mais on est défensif au cas où la cascade échoue silencieusement.
 */
export async function cleanupAdminRow(adminUserId: string): Promise<void> {
  const admin = getRawAdminClient();
  await admin.from('admin_users').delete().eq('id', adminUserId);
}

/**
 * Login UI admin standard. Le formulaire /connexion + getSessionUser()
 * branchent les cookies pour que le layout (admin) détecte session.isAdmin.
 */
export async function loginAsAdmin(page: Page, user: AdminTestUser): Promise<void> {
  await page.goto('/connexion');
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(user.password);
  await page
    .getByRole('button', { name: 'Se connecter', exact: true })
    .click();
  await page.waitForURL((url) => !url.pathname.startsWith('/connexion'));
}
