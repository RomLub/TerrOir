/**
 * E2E consumer/compte — dashboard /compte (Phase 3 cycle e2e exhaustif).
 *
 * Couvre :
 *   - Affichage prenom + email user (auth requise)
 *   - Sans auth : redirect /connexion (le layout consumer pose le redirect)
 *   - Producer-aware : si l'user a roles=['consumer','producer'], la sidebar
 *     affiche le lien "Espace producteur" via RoleSwitcher.
 *
 * Pattern : SSR coquille +  layout.tsx fait le redirect /connexion en absence
 * de session (cf. app/(consumer)/compte/layout.tsx). La page /compte expose
 * "Bienvenue, {prenom}" uniquement si profil.prenom est rempli.
 */

import { test, expect } from '../helpers/test-context';
import { seedConsumer, seedProducer } from '../helpers/db-seed';
import { loginAs } from '../helpers/user-lifecycle';
import { getReadOnlyAdminClient } from '../helpers/supabase-admin';

test.describe('Consumer — /compte dashboard', () => {
  test('affiche le prenom user post-login', async ({ page, ctx }) => {
    test.setTimeout(60_000);

    const user = await seedConsumer(ctx, { suffix: 'compte-dash' });

    // On poste un prenom AVANT login pour que la page /compte le rende
    // (la SSR query users.prenom hits cette colonne).
    const admin = getReadOnlyAdminClient();
    const { error: updateError } = await admin
      .from('users')
      .update({ prenom: 'Tester' })
      .eq('id', user.id);
    expect(updateError).toBeNull();

    await loginAs(page, user);
    await page.goto('/compte');

    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      /Bienvenue.*Tester/i,
    );
  });

  test('sans auth : /compte redirect vers /connexion', async ({ page }) => {
    test.setTimeout(60_000);

    // Pas de session : le layout (consumer)/compte/layout.tsx fait redirect.
    await page.goto('/compte');
    // Le redirect peut transporter ?redirectTo=/compte (middleware) ou non
    // (server redirect direct). On assert le pathname.
    await expect(page).toHaveURL(/\/connexion/, { timeout: 10_000 });
  });

  test('producer-aware : sidebar affiche le RoleSwitcher si roles inclut producer', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    // seedProducer crée un user avec roles=['consumer','producer'] et une row
    // producers (statut draft par défaut).
    const producer = await seedProducer(ctx, { suffix: 'compte-dual' });

    await loginAs(page, producer.user);
    await page.goto('/compte');

    // RoleSwitcher du sidebar rend un <div aria-current="page"> "Espace
    // acheteur" (current=consumer, non-cliquable) ET un <Link> "Espace
    // producteur" vers le subdomain pro. La navbar peut aussi rendre un
    // RoleToggle horizontal qui ajoute des matches "Espace acheteur" —
    // on cible le <aside> (sidebar /compte) pour rester déterministe.
    const sidebar = page.getByRole('complementary');
    await expect(
      sidebar.getByText('Espace acheteur', { exact: true }),
    ).toBeVisible();
    await expect(
      sidebar.getByRole('link', { name: 'Espace producteur', exact: true }),
    ).toBeVisible();
  });
});
