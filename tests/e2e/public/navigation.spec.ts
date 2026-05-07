/**
 * Pilote Phase 1 — navigation publique anonyme.
 *
 * Vérifie que la machinerie Playwright + webServer Next.js + storageState
 * (anon par défaut, pas de cookies de session) tourne correctement avant
 * de bâtir les ~164 tests des Phases 2-5.
 *
 * Pas d'auth, pas de DB write, pas de Stripe. Juste GET sur 2 pages
 * publiques et assertions DOM minimales.
 */

import { test, expect } from '@playwright/test';

test.describe('navigation publique anon', () => {
  test('home / répond et a un titre non vide', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status(), 'home GET').toBeLessThan(400);
    await expect(page).toHaveTitle(/.+/);
  });

  test('/producteurs liste des producers visibles publiquement', async ({ page }) => {
    const response = await page.goto('/producteurs');
    expect(response?.status(), '/producteurs GET').toBeLessThan(400);
    // Heading principal de la page (cf. app/(public)/producteurs/page.tsx).
    // Tolérant aux variations légères de wording : "Nos producteurs" /
    // "Producteurs" / "Découvrir les producteurs".
    await expect(
      page.getByRole('heading', { name: /producteurs/i }).first(),
    ).toBeVisible();
  });

  // Anti-régression : commit 187b82e (refactor DS terra) a supprimé le CTA
  // S'inscrire de la navbar publique. Bug détecté visuellement par Romain
  // 2026-05-07, non couvert par Phase 1-3 e2e (les tests bypass UI via
  // loginAs/storageState). Ces 3 tests verrouillent les chemins critiques
  // anonyme → inscription pour empêcher toute récurrence future.

  test('Header desktop navbar shows Inscription CTA when not logged', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await expect(
      page.getByRole('link', { name: /s'inscrire|inscription/i }).first(),
    ).toBeVisible();
  });

  test('Drawer mobile navbar shows Inscription CTA when not logged', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await page.getByLabel(/ouvrir le menu/i).click();
    await expect(
      page.getByRole('link', { name: /s'inscrire|inscription/i }).first(),
    ).toBeVisible();
  });

  test('/connexion page has signup redirect link', async ({ page }) => {
    await page.goto('/connexion');
    await expect(
      page
        .getByRole('link', { name: /créer un compte|inscription|pas de compte/i })
        .first(),
    ).toBeVisible();
  });
});
