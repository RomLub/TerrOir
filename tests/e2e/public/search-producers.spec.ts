/**
 * Phase 2 — recherche / filtrage producers publique anon.
 *
 * NB sur le naming des query params : la page /producteurs lit ses
 * filtres côté CLIENT via useSearchParams (cf.
 * app/(public)/producteurs/ProducteursClient.tsx). Les params réels
 * acceptés sont `especes`, `labels`, `rayon`, `mode_elevage`,
 * `alimentation`, `densite_animale`. PAS `cp` ni `type=elevage`
 * comme suggéré initialement par la spec. Le filtrage géographique
 * passe par navigator.geolocation côté client + radius — impossible
 * à driver côté SSR sans navigateur, donc on n'asserte que :
 *   - la page répond 200 même avec query params filtres
 *   - le heading principal reste visible
 *   - la query string est bien transmise (pas d'erreur SSR)
 *
 * Si plus tard une vraie route /api/producers/search est exposée
 * publiquement (cf. lib/producers/coords.ts mention dans CLAUDE.md),
 * ces tests pourront être enrichis avec assertions de payload JSON.
 */

import { test, expect } from '@playwright/test';

test.describe('recherche producers publique anon', () => {
  test('/producteurs?especes=bovin → page répond + heading visible', async ({
    page,
  }) => {
    const response = await page.goto('/producteurs?especes=bovin');
    expect(response?.status(), '/producteurs filtré GET').toBeLessThan(400);
    await expect(
      page.getByRole('heading', { level: 1, name: /producteurs/i }),
    ).toBeVisible();
  });

  test('/producteurs?labels=bio → page répond + heading visible', async ({
    page,
  }) => {
    const response = await page.goto('/producteurs?labels=bio');
    expect(response?.status(), '/producteurs filtré labels GET').toBeLessThan(
      400,
    );
    await expect(
      page.getByRole('heading', { level: 1, name: /producteurs/i }),
    ).toBeVisible();
  });
});
