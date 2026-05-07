/**
 * Reachability — NavbarPublic producer connecté.
 *
 * Setup : seedProducer({statut:'public'}) → loginViaUIForm. Pas de
 * shortcut auth.
 *
 * Note : la NavbarPublic n'est rendue que sur les route groups (public)
 * et (consumer). Sur les routes (producer) (/dashboard, /ma-page, ...)
 * c'est ProducerLayout (sidebar) qui prend le relais. Donc les
 * assertions navbar se font sur / ou /producteurs (root public layout).
 *
 * Les routes /dashboard et /ma-page sont protégées : en prod le
 * middleware redirige sur pro.terroir-local.fr ; en local (host=localhost)
 * le check host est skip (NODE_ENV !== 'production') et la route est
 * directement servie. Les tests vérifient juste que la navigation
 * vers /dashboard depuis le toggle role atteint bien la cible.
 */

import { test, expect } from '../helpers/test-context';
import { createTestProducer } from '../helpers/producer-lifecycle';
import { loginViaUIForm } from './_contracts/login-via-ui';

test.describe('reachability — navbar producer connecté', () => {
  test.describe('desktop (1280×800)', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('Mon compte link visible (producer = consumer + producer dans roles)', async ({
      page,
      ctx,
    }) => {
      test.setTimeout(60_000);
      const producer = await createTestProducer(ctx, {
        suffix: 'rp-desktop-account',
        statut: 'public',
      });
      await loginViaUIForm(page, producer.user.email, producer.user.password);
      await page.goto('/');
      // Sur la NavbarPublic, le link user pointe vers /compte (cf. l.254
      // navbar-public.tsx) — c'est le côté consumer qui est rendu ici.
      // :visible cible le link desktop (mobile/drawer cachés à 1280px).
      await expect(
        page.locator('header a[href="/compte"]:visible').first(),
      ).toBeVisible();
    });

    test('Déconnexion bouton visible', async ({ page, ctx }) => {
      test.setTimeout(60_000);
      const producer = await createTestProducer(ctx, {
        suffix: 'rp-desktop-logout',
        statut: 'public',
      });
      await loginViaUIForm(page, producer.user.email, producer.user.password);
      await page.goto('/');
      await expect(
        page.getByRole('button', { name: /^déconnexion$/i }).first(),
      ).toBeVisible();
    });

    test('RoleToggle visible (dual-rôle consumer+producer) avec Espace producteur', async ({
      page,
      ctx,
    }) => {
      test.setTimeout(60_000);
      const producer = await createTestProducer(ctx, {
        suffix: 'rp-desktop-toggle',
        statut: 'public',
      });
      await loginViaUIForm(page, producer.user.email, producer.user.password);
      await page.goto('/');
      // Cible la nav aria-label "Basculer d'espace" (cf. role-toggle.tsx l.27).
      const toggle = page.getByRole('navigation', {
        name: /basculer d['’]espace/i,
      });
      await expect(toggle).toBeVisible();
      await expect(
        toggle.getByRole('link', { name: /espace producteur/i }),
      ).toBeVisible();
    });

    test('Click Espace producteur → URL pro subdomain (or /dashboard local)', async ({
      page,
      ctx,
    }) => {
      test.setTimeout(60_000);
      const producer = await createTestProducer(ctx, {
        suffix: 'rp-toggle-click',
        statut: 'public',
      });
      await loginViaUIForm(page, producer.user.email, producer.user.password);
      await page.goto('/');
      const link = page
        .getByRole('navigation', { name: /basculer d['’]espace/i })
        .getByRole('link', { name: /espace producteur/i });
      // L'URL cible peut être un subdomain (prod) ou un path local (test).
      // On capte le href avant clic : si subdomain externe, on évite la
      // navigation cross-origin et on assert sur le href seul.
      const href = await link.getAttribute('href');
      expect(href, 'href Espace producteur non null').toBeTruthy();
      // En local, getRoleSwitcherUrls peut retourner soit /dashboard soit
      // une URL pro.localhost selon config — on accepte les 2 patterns.
      expect(href).toMatch(/(dashboard|pro\.|localhost)/i);
    });
  });

  test.describe('mobile (375×812)', () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test('drawer mobile : RoleToggle producer présent en tête', async ({
      page,
      ctx,
    }) => {
      test.setTimeout(60_000);
      const producer = await createTestProducer(ctx, {
        suffix: 'rp-mob-toggle',
        statut: 'public',
      });
      await loginViaUIForm(page, producer.user.email, producer.user.password);
      await page.goto('/');
      await page.getByLabel(/ouvrir le menu/i).click();
      const drawer = page.getByRole('dialog', { name: /menu de navigation/i });
      await expect(drawer).toBeVisible();
      // RoleToggle dans le drawer (cf. navbar-public.tsx l.328-330).
      await expect(
        drawer.getByRole('navigation', { name: /basculer d['’]espace/i }),
      ).toBeVisible();
    });

    test('drawer mobile : Mon compte link visible', async ({ page, ctx }) => {
      test.setTimeout(60_000);
      const producer = await createTestProducer(ctx, {
        suffix: 'rp-mob-account',
        statut: 'public',
      });
      await loginViaUIForm(page, producer.user.email, producer.user.password);
      await page.goto('/');
      await page.getByLabel(/ouvrir le menu/i).click();
      const drawer = page.getByRole('dialog', { name: /menu de navigation/i });
      await expect(drawer.locator('a[href="/compte"]').first()).toBeVisible();
    });

    test('drawer mobile : Déconnexion bouton visible', async ({ page, ctx }) => {
      test.setTimeout(60_000);
      const producer = await createTestProducer(ctx, {
        suffix: 'rp-mob-logout',
        statut: 'public',
      });
      await loginViaUIForm(page, producer.user.email, producer.user.password);
      await page.goto('/');
      await page.getByLabel(/ouvrir le menu/i).click();
      const drawer = page.getByRole('dialog', { name: /menu de navigation/i });
      await expect(
        drawer.getByRole('button', { name: /^déconnexion$/i }),
      ).toBeVisible();
    });
  });

  test.describe('routes producer dashboard', () => {
    test('Page /dashboard reachable directement (statut=public)', async ({
      page,
      ctx,
    }) => {
      test.setTimeout(60_000);
      const producer = await createTestProducer(ctx, {
        suffix: 'rp-direct-dash',
        statut: 'public',
      });
      await loginViaUIForm(page, producer.user.email, producer.user.password);
      const response = await page.goto('/dashboard');
      // En local (NODE_ENV !== production), ProducerLayout host check skip.
      // Page rend ProducerLayout sidebar avec link Dashboard actif.
      expect(response?.status(), '/dashboard GET').toBeLessThan(400);
    });

    test('Page /ma-page reachable directement (statut=public)', async ({
      page,
      ctx,
    }) => {
      test.setTimeout(60_000);
      const producer = await createTestProducer(ctx, {
        suffix: 'rp-direct-mapage',
        statut: 'public',
      });
      await loginViaUIForm(page, producer.user.email, producer.user.password);
      const response = await page.goto('/ma-page');
      expect(response?.status(), '/ma-page GET').toBeLessThan(400);
    });
  });
});
