/**
 * E2E admin — /tableau-de-bord (dashboard) sanity + ACL.
 *
 * Couverture (2 tests) :
 *   1. Admin loggué accède /tableau-de-bord → page rendue (titre Back-office
 *      visible, sidebar avec lien Gestion producteurs).
 *   2. Visiteur anonyme tente /tableau-de-bord → redirect /connexion par le
 *      layout (admin) qui enforce session.isAdmin (defense-in-depth en plus
 *      du middleware host-check qui n'est actif qu'en production).
 *
 * NB : la page /tableau-de-bord actuelle est minimaliste (juste un h1
 * "Back-office"). Les "métriques clés" évoquées dans le brief slot ne sont
 * pas implémentées — l'UI dashboard reste un stub. On valide donc juste la
 * sanity rendu + ACL, pas les compteurs.
 */

import { test, expect } from '../helpers/test-context';
import { createAdminUser, cleanupAdminRow, loginAsAdmin } from './_helpers';

test.describe('Admin — Dashboard', () => {
  test('admin loggué accède /tableau-de-bord → page rendue', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const adminUser = await createAdminUser(ctx, 'dashboard-ok');

    try {
      await loginAsAdmin(page, adminUser);

      await page.goto('/tableau-de-bord');
      // Le AdminHeader rend le label "Back-office" en uppercase.
      await expect(
        page.getByText(/Back-office/i).first(),
      ).toBeVisible({ timeout: 10_000 });
      // La sidebar contient le lien Gestion producteurs (signal layout admin).
      await expect(
        page.getByRole('link', { name: /Gestion producteurs/i }),
      ).toBeVisible();
    } finally {
      await cleanupAdminRow(adminUser.id);
    }
  });

  test('anonyme sur /tableau-de-bord → redirect /connexion', async ({
    page,
  }) => {
    test.setTimeout(30_000);

    await page.goto('/tableau-de-bord');
    // Layout (admin) → if (!session?.isAdmin) redirect("/connexion").
    // Pour un anonyme, getSessionUser renvoie null → redirect.
    await expect(page).toHaveURL(/\/connexion/, { timeout: 10_000 });
  });
});
