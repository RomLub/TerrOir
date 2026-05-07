/**
 * Phase 2 — pages légales publiques anonymes (P0 légales 2026-05-06).
 *
 * Vérifie que les 4 pages obligatoires (CGU, CGV, mentions légales,
 * politique de confidentialité) répondent 200 et exposent le bon h1.
 *
 * Pas de DB write, pas d'auth — assertions DOM minimales pour gardes
 * d'intégrité du shell SEO. Si une de ces pages disparaît ou perd son
 * heading, l'audit pré-Live (T-003) détecte le régression côté CI E2E.
 */

import { test, expect } from '@playwright/test';

test.describe('pages légales publiques anon', () => {
  test('/cgu répond 200 + heading "Conditions générales d\'utilisation"', async ({
    page,
  }) => {
    const response = await page.goto('/cgu');
    expect(response?.status(), '/cgu GET').toBeLessThan(400);
    await expect(
      page.getByRole('heading', { level: 1, name: /conditions générales d['’]utilisation/i }),
    ).toBeVisible();
  });

  test('/cgv répond 200 + heading "Conditions générales de vente"', async ({
    page,
  }) => {
    const response = await page.goto('/cgv');
    expect(response?.status(), '/cgv GET').toBeLessThan(400);
    await expect(
      page.getByRole('heading', { level: 1, name: /conditions générales de vente/i }),
    ).toBeVisible();
  });

  test('/mentions-legales répond 200 + heading "Mentions légales"', async ({
    page,
  }) => {
    const response = await page.goto('/mentions-legales');
    expect(response?.status(), '/mentions-legales GET').toBeLessThan(400);
    await expect(
      page.getByRole('heading', { level: 1, name: /mentions légales/i }),
    ).toBeVisible();
  });

  test('/politique-confidentialite répond 200 + heading "Politique de confidentialité"', async ({
    page,
  }) => {
    const response = await page.goto('/politique-confidentialite');
    expect(response?.status(), '/politique-confidentialite GET').toBeLessThan(400);
    await expect(
      page.getByRole('heading', { level: 1, name: /politique de confidentialité/i }),
    ).toBeVisible();
  });
});
