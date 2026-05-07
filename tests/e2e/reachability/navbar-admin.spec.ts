/**
 * Reachability — NavbarPublic admin connecté.
 *
 * Setup : createTestUser(ctx) + INSERT admin_users via getRawAdminClient
 * + loginViaUIForm. Pas de shortcut auth.
 *
 * Important : sur les routes (admin) c'est AdminHeader (pas NavbarPublic).
 * Pour tester ce que la NavbarPublic affiche pour un admin connecté, on
 * doit aller sur une page (public), p.ex. /producteurs ou /carte. La home
 * `/` posera problème car le middleware redirige sur admin.* vers
 * /tableau-de-bord automatiquement, mais en local NODE_ENV !== 'production'
 * ce check est désactivé partiellement (cf. middleware l.143-173).
 *
 * Stratégie de robustesse : tests sur /producteurs (route public, pas de
 * middleware redirect lié à admin pour ce path).
 *
 * NB : la doctrine "users public.users vs admin_users mutuellement
 * exclusifs" (trigger users_exclusive_with_admin) impose un pattern
 * spécial : INSERT admin_users SANS public.users. Mais createTestUser
 * fait l'INSERT public.users d'office. Ici on doit faire un upgrade
 * manuel : DELETE public.users → INSERT admin_users.
 */

import { test, expect } from '../helpers/test-context';
import { createTestUser } from '../helpers/user-lifecycle';
import { getRawAdminClient } from '../helpers/supabase-admin';
import { loginViaUIForm } from './_contracts/login-via-ui';

async function makeAdminUser(
  ctx: Parameters<typeof createTestUser>[0],
  suffix: string,
): Promise<{ email: string; password: string; id: string }> {
  const user = await createTestUser(ctx, { suffix });
  const admin = getRawAdminClient();
  // Trigger users_exclusive_with_admin bloque la coexistence public.users +
  // admin_users — on doit DELETE public.users avant INSERT admin_users.
  await admin.from('users').delete().eq('id', user.id);
  const { error } = await admin.from('admin_users').insert({ id: user.id });
  if (error) throw new Error(`makeAdminUser INSERT admin_users failed: ${error.message}`);
  return { email: user.email, password: user.password, id: user.id };
}

test.describe('reachability — navbar admin connecté', () => {
  test.describe('desktop (1280×800)', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('Tableau de bord link visible (Mon compte remplacé par /tableau-de-bord)', async ({
      page,
      ctx,
    }) => {
      test.setTimeout(60_000);
      const user = await makeAdminUser(ctx, 'ra-desktop-tdb');
      await loginViaUIForm(page, user.email, user.password);
      // Aller sur /producteurs (route publique, pas de middleware admin redirect).
      await page.goto('/producteurs');
      // NavbarPublic l.254 : isAdmin → href="/tableau-de-bord"
      // :visible cible la version desktop (mobile/drawer cachés à 1280px).
      await expect(
        page.locator('header a[href="/tableau-de-bord"]:visible').first(),
      ).toBeVisible();
    });

    test('Badge Admin visible à côté du link tableau de bord', async ({
      page,
      ctx,
    }) => {
      test.setTimeout(60_000);
      const user = await makeAdminUser(ctx, 'ra-desktop-badge');
      await loginViaUIForm(page, user.email, user.password);
      await page.goto('/producteurs');
      // Badge variant="green" rendu uniquement si isAdmin (cf.
      // navbar-public.tsx l.260).
      await expect(
        page.locator('header').getByText(/^admin$/i).first(),
      ).toBeVisible();
    });

    test('Déconnexion bouton visible', async ({ page, ctx }) => {
      test.setTimeout(60_000);
      const user = await makeAdminUser(ctx, 'ra-desktop-logout');
      await loginViaUIForm(page, user.email, user.password);
      await page.goto('/producteurs');
      await expect(
        page.getByRole('button', { name: /^déconnexion$/i }).first(),
      ).toBeVisible();
    });

    test('Panier ABSENT (isAdmin masque CartNavButton desktop)', async ({
      page,
      ctx,
    }) => {
      test.setTimeout(60_000);
      const user = await makeAdminUser(ctx, 'ra-desktop-no-panier');
      await loginViaUIForm(page, user.email, user.password);
      await page.goto('/producteurs');
      // CartNavButton variant="desktop" rendu uniquement si !isAdmin
      // (cf. navbar-public.tsx l.291).
      await expect(
        page.locator('header a[href="/compte/panier"]'),
      ).toHaveCount(0);
    });

    test('Click Tableau de bord → /tableau-de-bord', async ({ page, ctx }) => {
      test.setTimeout(60_000);
      const user = await makeAdminUser(ctx, 'ra-desktop-click');
      await loginViaUIForm(page, user.email, user.password);
      await page.goto('/producteurs');
      await page
        .locator('header a[href="/tableau-de-bord"]:visible')
        .first()
        .click();
      // En local, /tableau-de-bord est servi (host check skip si !production).
      // En prod ça redirige sur admin.* — on tolère les 2.
      await page.waitForLoadState('networkidle', { timeout: 15_000 });
      const url = page.url();
      expect(url).toMatch(/(\/tableau-de-bord|admin\.)/i);
    });
  });

  test.describe('mobile (375×812)', () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test('drawer mobile : link Tableau de bord visible', async ({
      page,
      ctx,
    }) => {
      test.setTimeout(60_000);
      const user = await makeAdminUser(ctx, 'ra-mob-tdb');
      await loginViaUIForm(page, user.email, user.password);
      await page.goto('/producteurs');
      await page.getByLabel(/ouvrir le menu/i).click();
      const drawer = page.getByRole('dialog', { name: /menu de navigation/i });
      await expect(drawer).toBeVisible();
      // Drawer l.359-367 : isAdmin → href="/tableau-de-bord"
      await expect(
        drawer.locator('a[href="/tableau-de-bord"]').first(),
      ).toBeVisible();
    });

    test('drawer mobile : Badge Admin visible (rendu inline avec link)', async ({
      page,
      ctx,
    }) => {
      test.setTimeout(60_000);
      const user = await makeAdminUser(ctx, 'ra-mob-badge');
      await loginViaUIForm(page, user.email, user.password);
      await page.goto('/producteurs');
      await page.getByLabel(/ouvrir le menu/i).click();
      const drawer = page.getByRole('dialog', { name: /menu de navigation/i });
      await expect(drawer).toBeVisible();
      // Badge "Admin" inline dans le link header (l.366).
      await expect(drawer.getByText(/^admin$/i).first()).toBeVisible();
    });

    test('drawer mobile : Déconnexion bouton visible', async ({ page, ctx }) => {
      test.setTimeout(60_000);
      const user = await makeAdminUser(ctx, 'ra-mob-logout');
      await loginViaUIForm(page, user.email, user.password);
      await page.goto('/producteurs');
      await page.getByLabel(/ouvrir le menu/i).click();
      const drawer = page.getByRole('dialog', { name: /menu de navigation/i });
      await expect(
        drawer.getByRole('button', { name: /^déconnexion$/i }),
      ).toBeVisible();
    });
  });
});
