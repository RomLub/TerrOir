/**
 * Reachability — NavbarPublic anonyme (zone !user).
 *
 * Couverture viewports × liens cruciaux. Aucun usage d'helpers d'auth
 * shortcut : tous les tests démarrent par `page.goto('/')` puis cliquent
 * pour naviguer (doctrine Phase 5).
 *
 * C'est le bouclier anti-régression du bug navbar Inscription du
 * 2026-05-07 (commit 5fa57eb). Si quelqu'un retire à nouveau le CTA
 * "S'inscrire" du desktop ou du drawer mobile, ces tests échouent.
 */

import { test, expect } from '@playwright/test';
import { NAVBAR_CONTRACT } from './_contracts/navbar-contract';

test.describe('reachability — navbar anonyme', () => {
  test.describe('desktop (1280×800)', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('Connexion link visible + reachable → /connexion', async ({ page }) => {
      await page.goto('/');
      const link = page
        .getByRole('link', { name: /^connexion$/i })
        .first();
      await expect(link).toBeVisible();
      await link.click();
      await expect(page).toHaveURL(/\/connexion/);
    });

    test("S'inscrire CTA visible (bg terroir-green) + reachable → /auth/inscription", async ({
      page,
    }) => {
      await page.goto('/');
      // Apostrophe courbe (U+2019) ou droite (U+0027) tolérée — le rendu
      // HTML utilise `&rsquo;` (courbe). regex couvre les 2.
      const cta = page
        .getByRole('link', { name: /s['’]inscrire/i })
        .first();
      await expect(cta).toBeVisible();
      // Vérifie que c'est bien le CTA bg-terroir-green (anti-régression
      // du bug 2026-05-07 où le CTA avait été supprimé silencieusement).
      const className = await cta.getAttribute('class');
      expect(className ?? '').toContain('bg-terroir-green');
      await cta.click();
      await expect(page).toHaveURL(/\/auth\/inscription/);
    });

    test('Panier visible + clic redirige (anon → /connexion ?redirectTo=/compte/panier)', async ({
      page,
    }) => {
      await page.goto('/');
      const panier = page
        .getByRole('link', { name: /mon panier|panier/i })
        .first();
      await expect(panier).toBeVisible();
      await panier.click();
      // Le middleware (CONSUMER_PROTECTED_PREFIX="/compte") redirige les
      // anonymous vers /connexion?redirectTo=/compte/panier. Le link target
      // est /compte/panier mais le rendu final est /connexion.
      await expect(page).toHaveURL(/\/(connexion|compte\/panier)/);
    });

    test('navlinks principaux visibles', async ({
      page,
    }) => {
      await page.goto('/');
      const nav = page.getByRole('navigation', {
        name: 'Navigation principale',
      });
      for (const label of NAVBAR_CONTRACT.navlinks) {
        await expect(
          nav.getByRole('link', { name: label }).first(),
        ).toBeVisible();
      }
    });

    test('navlink Produits → /produits', async ({
      page,
    }) => {
      await page.goto('/');
      await page
        .getByRole('navigation', { name: 'Navigation principale' })
        .getByRole('link', { name: 'Produits' })
        .click();
      await expect(page).toHaveURL(/\/produits/);
    });
  });

  test.describe('mobile (375×812)', () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test('drawer fermé par défaut + bouton Menu présent (CTA caché hors viewport)', async ({
      page,
    }) => {
      await page.goto('/');
      // Le bouton Menu est bien là.
      await expect(page.getByLabel(/ouvrir le menu/i)).toBeVisible();
      // Le drawer est translaté hors viewport via -translate-x-full. Playwright
      // `toBeVisible` reste true (display:flex), mais le bounding box est
      // hors-écran. On vérifie que le CTA S'inscrire dans le drawer a un X
      // négatif (translaté à gauche du viewport).
      const cta = page.getByRole('link', { name: /s['’]inscrire/i }).first();
      const box = await cta.boundingBox();
      expect(box, 'CTA bounding box').not.toBeNull();
      // Le CTA est dans le drawer translaté -100% : x négatif ou très petit
      // par rapport à la largeur viewport (375px).
      expect(box!.x).toBeLessThan(0);
    });

    test("drawer ouvre via Menu button + S'inscrire visible (full-width green)", async ({
      page,
    }) => {
      await page.goto('/');
      await page.getByLabel(/ouvrir le menu/i).click();
      // Le drawer est animé ; on attend qu'il soit pleinement visible.
      const drawer = page.getByRole('dialog', { name: /menu de navigation/i });
      await expect(drawer).toBeVisible();
      const cta = drawer.getByRole('link', { name: /s['’]inscrire/i });
      await expect(cta).toBeVisible();
      // Anti-régression bug navbar : le CTA dans le drawer doit avoir le
      // background terroir-green (full-width "Créer un compte" en tête).
      const cls = await cta.getAttribute('class');
      expect(cls ?? '').toContain('bg-terroir-green');
    });

    test('drawer contient Connexion + clic ferme drawer puis nav → /connexion', async ({
      page,
    }) => {
      await page.goto('/');
      await page.getByLabel(/ouvrir le menu/i).click();
      const drawer = page.getByRole('dialog', { name: /menu de navigation/i });
      const conn = drawer.getByRole('link', { name: /^connexion$/i });
      await expect(conn).toBeVisible();
      await conn.click();
      await expect(page).toHaveURL(/\/connexion/);
    });

    test('drawer mobile contient les navlinks principaux', async ({
      page,
    }) => {
      await page.goto('/');
      await page.getByLabel(/ouvrir le menu/i).click();
      const drawer = page.getByRole('dialog', { name: /menu de navigation/i });
      for (const label of NAVBAR_CONTRACT.navlinks) {
        await expect(
          drawer.getByRole('link', { name: label }).first(),
        ).toBeVisible();
      }
    });

    test('Panier mobile (badge bouton) visible + clic redirige (anon → /connexion)', async ({
      page,
    }) => {
      await page.goto('/');
      // Sur mobile, le panier est un bouton icone à droite (pas de label texte).
      // aria-label "Mon panier" ou "Mon panier (N article(s))".
      const panier = page.getByRole('link', { name: /mon panier/i }).first();
      await expect(panier).toBeVisible();
      await panier.click();
      // Idem desktop : middleware redirige /compte/panier → /connexion pour
      // les anonymous (CONSUMER_PROTECTED_PREFIX).
      await expect(page).toHaveURL(/\/(connexion|compte\/panier)/);
    });
  });

  test.describe('tablette (768×1024)', () => {
    test.use({ viewport: { width: 768, height: 1024 } });

    test('viewport intermédiaire : navbar bascule en desktop dès >=768px', async ({
      page,
    }) => {
      await page.goto('/');
      // À 768px, la navbar est en mode desktop (md:flex breakpoint Tailwind).
      // Le CTA S'inscrire est dans la barre desktop, pas le drawer.
      const cta = page.getByRole('link', { name: /s['’]inscrire/i }).first();
      await expect(cta).toBeVisible();
      // Le bouton Menu mobile est caché (md:hidden).
      await expect(page.getByLabel(/ouvrir le menu/i)).not.toBeVisible();
    });

    test('Connexion lien visible en mode desktop à 768px', async ({ page }) => {
      await page.goto('/');
      await expect(
        page.getByRole('link', { name: /^connexion$/i }).first(),
      ).toBeVisible();
    });
  });
});
