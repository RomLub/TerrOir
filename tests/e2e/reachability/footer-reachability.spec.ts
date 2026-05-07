/**
 * Reachability — Footer présent sur toutes les pages publiques + liens
 * légaux/aide cliquables et menant aux bonnes URLs.
 *
 * Doctrine reachability : aucun shortcut auth (footer rendu sur public
 * layout, pas de session requise pour ce volet).
 *
 * Source de vérité : components/ui/footer.tsx (defaultColumns + Aide
 * column + footer bottom légales).
 */

import { test, expect } from '@playwright/test';

const PUBLIC_PAGES = [
  '/',
  '/producteurs',
  '/carte',
  '/notre-demarche',
  '/comment-ca-marche',
];

test.describe('reachability — footer présence + liens', () => {
  for (const path of PUBLIC_PAGES) {
    test(`Footer rendu sur ${path}`, async ({ page }) => {
      await page.goto(path);
      // Footer = role="contentinfo" implicite via <footer>. Le copyright
      // "© <year> TerrOir · Sarthe" est un marqueur stable.
      await expect(
        page.getByText(/©\s*\d{4}\s+terroir.*sarthe/i).first(),
      ).toBeVisible();
    });
  }

  test('Footer link Mentions légales depuis / → /mentions-legales', async ({
    page,
  }) => {
    await page.goto('/');
    const footer = page.locator('footer');
    await footer
      .getByRole('link', { name: /mentions légales/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/mentions-legales/);
  });

  test('Footer link CGU depuis / → /cgu', async ({ page }) => {
    await page.goto('/');
    const footer = page.locator('footer');
    await footer.getByRole('link', { name: /^cgu$/i }).first().click();
    await expect(page).toHaveURL(/\/cgu/);
  });

  test('Footer link CGV depuis / → /cgv', async ({ page }) => {
    await page.goto('/');
    const footer = page.locator('footer');
    await footer.getByRole('link', { name: /^cgv$/i }).first().click();
    await expect(page).toHaveURL(/\/cgv/);
  });

  test('Footer link FAQ depuis / → /faq', async ({ page }) => {
    await page.goto('/');
    const footer = page.locator('footer');
    await footer
      .getByRole('link', { name: /^faq$/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/faq/);
  });

  test('Footer link Politique de confidentialité depuis / → /politique-confidentialite', async ({
    page,
  }) => {
    await page.goto('/');
    const footer = page.locator('footer');
    await footer
      .getByRole('link', { name: /politique de confidentialité/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/politique-confidentialite/);
  });

  test('Footer link Contact depuis / → /contact', async ({ page }) => {
    await page.goto('/');
    const footer = page.locator('footer');
    await footer
      .getByRole('link', { name: /^contact$/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/contact/);
  });

  test('Footer link Livraison et retrait depuis / → /livraison', async ({
    page,
  }) => {
    await page.goto('/');
    const footer = page.locator('footer');
    await footer
      .getByRole('link', { name: /livraison et retrait/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/livraison/);
  });

  test('Footer link Producteurs (col Acheter) depuis / → /producteurs', async ({
    page,
  }) => {
    await page.goto('/');
    const footer = page.locator('footer');
    await footer
      .getByRole('link', { name: /^producteurs$/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/producteurs/);
  });

  test('Footer link Devenir producteur depuis / → /devenir-producteur', async ({
    page,
  }) => {
    await page.goto('/');
    const footer = page.locator('footer');
    await footer
      .getByRole('link', { name: /devenir producteur/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/devenir-producteur/);
  });

  test('Footer link Comment ça marche depuis / → /comment-ca-marche', async ({
    page,
  }) => {
    await page.goto('/');
    const footer = page.locator('footer');
    await footer
      .getByRole('link', { name: /comment ça marche/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/comment-ca-marche/);
  });
});
