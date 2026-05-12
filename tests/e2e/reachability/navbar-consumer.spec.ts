/**
 * Reachability — NavbarPublic consumer connecté.
 *
 * Setup : createTestUser(ctx) → loginViaUIForm (helper local). Pas de
 * loginAs / storageState shortcut (doctrine reachability Phase 5).
 *
 * Le consumer pur (rôle ['consumer']) voit la NavbarPublic sur les
 * routes (public) et (consumer)/compte/*. RoleToggle rend null s'il
 * n'a pas le couple ['consumer','producer'].
 */

import { test, expect } from '../helpers/test-context';
import { createTestUser } from '../helpers/user-lifecycle';
import { loginViaUIForm } from './_contracts/login-via-ui';

test.describe('reachability — navbar consumer connecté', () => {
  test.describe('desktop (1280×800)', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('Mon compte link visible avec prénom/email tronqué', async ({
      page,
      ctx,
    }) => {
      test.setTimeout(60_000);
      const user = await createTestUser(ctx, { suffix: 'rc-desktop-account' });
      await loginViaUIForm(page, user.email, user.password);
      await page.goto('/');

      // Le link Mon compte rend le prénom OU email tronqué dans son span
      // (cf. NavbarPublic l.253-259). On cible via le href canonique
      // /compte (NavbarPublic l.254 : isAdmin ? "/tableau-de-bord" : "/compte").
      // :visible pour cibler l'instance desktop bar (mobile bar md:hidden
      // et drawer translaté hors viewport à 1280px).
      const compteLink = page
        .locator('header a[href="/compte"]:visible')
        .first();
      await expect(compteLink).toBeVisible();
    });

    test('Déconnexion bouton visible', async ({ page, ctx }) => {
      test.setTimeout(60_000);
      const user = await createTestUser(ctx, { suffix: 'rc-desktop-logout' });
      await loginViaUIForm(page, user.email, user.password);
      await page.goto('/');
      await expect(
        page.getByRole('button', { name: /^déconnexion$/i }).first(),
      ).toBeVisible();
    });

    test('Panier visible (consumer non admin → CartNavButton rendu)', async ({
      page,
      ctx,
    }) => {
      test.setTimeout(60_000);
      const user = await createTestUser(ctx, { suffix: 'rc-desktop-panier' });
      await loginViaUIForm(page, user.email, user.password);
      await page.goto('/');
      // Le DOM contient 2 liens panier (mobile bar md:hidden + desktop bar
      // md:flex). À 1280px, on cible le visible explicitement via :visible.
      const panier = page
        .locator('header a[href="/compte/panier"]:visible')
        .first();
      await expect(panier).toBeVisible();
    });

    test('RoleToggle absent pour consumer pur (pas de role producer)', async ({
      page,
      ctx,
    }) => {
      test.setTimeout(60_000);
      const user = await createTestUser(ctx, { suffix: 'rc-no-toggle' });
      await loginViaUIForm(page, user.email, user.password);
      await page.goto('/');
      // RoleToggle rend null si pas dual-rôle (cf. role-toggle.tsx l.24).
      // Aucun nav aria-label "Basculer d'espace" présent.
      await expect(
        page.getByRole('navigation', { name: /basculer d['’]espace/i }),
      ).toHaveCount(0);
    });

    test('Click Mon compte → /compte', async ({ page, ctx }) => {
      test.setTimeout(60_000);
      const user = await createTestUser(ctx, { suffix: 'rc-click-compte' });
      await loginViaUIForm(page, user.email, user.password);
      await page.goto('/');
      await page
        .locator('header a[href="/compte"]:visible')
        .first()
        .click();
      await expect(page).toHaveURL(/\/compte(\?|$|\/)/);
    });

    test('Click Panier → /compte/panier', async ({ page, ctx }) => {
      test.setTimeout(60_000);
      const user = await createTestUser(ctx, { suffix: 'rc-click-panier' });
      await loginViaUIForm(page, user.email, user.password);
      await page.goto('/');
      // Cible le link panier visible (desktop bar md:flex à 1280px). Voir
      // commentaire test précédent pour le rationnel :visible.
      await page
        .locator('header a[href="/compte/panier"]:visible')
        .first()
        .click();
      await expect(page).toHaveURL(/\/compte\/panier/);
    });

    test('Click Déconnexion → redirect / (home) + état anonyme restauré', async ({
      page,
      ctx,
    }) => {
      test.setTimeout(60_000);
      const user = await createTestUser(ctx, { suffix: 'rc-click-logout' });
      await loginViaUIForm(page, user.email, user.password);
      await page.goto('/');
      await page
        .getByRole('button', { name: /^déconnexion$/i })
        .first()
        .click();
      // Logout flow redirige vers /. On attend un état où "S'inscrire"
      // réapparait dans la navbar (signal !user re-rendu).
      await expect(
        page.getByRole('link', { name: /s['’]inscrire/i }).first(),
      ).toBeVisible({ timeout: 15_000 });
    });
  });

  test.describe('mobile (375×812)', () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test('drawer mobile : Mon compte link visible après ouverture', async ({
      page,
      ctx,
    }) => {
      test.setTimeout(60_000);
      const user = await createTestUser(ctx, { suffix: 'rc-mob-account' });
      await loginViaUIForm(page, user.email, user.password);
      await page.goto('/');
      await page.getByLabel(/ouvrir le menu/i).click();
      const drawer = page.getByRole('dialog', { name: /menu de navigation/i });
      await expect(drawer).toBeVisible();
      // Le link Mon compte dans le drawer pointe vers /compte
      const link = drawer.locator('a[href="/compte"]').first();
      await expect(link).toBeVisible();
    });

    test('drawer mobile : Déconnexion bouton visible après ouverture', async ({
      page,
      ctx,
    }) => {
      test.setTimeout(60_000);
      const user = await createTestUser(ctx, { suffix: 'rc-mob-logout' });
      await loginViaUIForm(page, user.email, user.password);
      await page.goto('/');
      await page.getByLabel(/ouvrir le menu/i).click();
      const drawer = page.getByRole('dialog', { name: /menu de navigation/i });
      await expect(
        drawer.getByRole('button', { name: /^déconnexion$/i }),
      ).toBeVisible();
    });

    test("drawer mobile : pas de S'inscrire (user déjà connecté)", async ({
      page,
      ctx,
    }) => {
      test.setTimeout(60_000);
      const user = await createTestUser(ctx, { suffix: 'rc-mob-no-signup' });
      await loginViaUIForm(page, user.email, user.password);
      await page.goto('/');
      await page.getByLabel(/ouvrir le menu/i).click();
      const drawer = page.getByRole('dialog', { name: /menu de navigation/i });
      await expect(drawer).toBeVisible();
      // S'inscrire est rendu uniquement dans la branche !user du drawer.
      await expect(
        drawer.getByRole('link', { name: /s['’]inscrire/i }),
      ).toHaveCount(0);
    });

    test('Panier mobile (icône) visible — CartNavButton variant="mobile"', async ({
      page,
      ctx,
    }) => {
      test.setTimeout(60_000);
      const user = await createTestUser(ctx, { suffix: 'rc-mob-panier' });
      await loginViaUIForm(page, user.email, user.password);
      await page.goto('/');
      // Sur mobile, panier est un bouton icone aria-label "Mon panier".
      const panier = page.getByRole('link', { name: /mon panier/i }).first();
      await expect(panier).toBeVisible();
    });
  });
});
