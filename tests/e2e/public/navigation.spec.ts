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
});
