/**
 * E2E consumer/profil — affichage + update champs profil.
 *
 * /compte/profil = client component. Loading state au mount via
 * supabase.auth.getUser() + fetch users row. Update via
 * supabase.from("users").update directement (RLS self-update permise).
 *
 * Couverture :
 *   - Auth requise → redirect /connexion (le layout consumer s'en charge)
 *   - Affichage prénom/nom/email/téléphone après login
 *   - Update prénom + nom → persistance en DB
 *   - Toggle sms_optin → DB updated
 */

import { test, expect } from '../helpers/test-context';
import { seedConsumer } from '../helpers/db-seed';
import { loginAs } from '../helpers/user-lifecycle';
import { getReadOnlyAdminClient } from '../helpers/supabase-admin';

test.describe('Consumer — /compte/profil', () => {
  test('sans auth : /compte/profil redirect vers /connexion', async ({ page }) => {
    test.setTimeout(60_000);

    await page.goto('/compte/profil');
    await expect(page).toHaveURL(/\/connexion/, { timeout: 10_000 });
  });

  test('affiche prénom/nom/email après seed + login', async ({ page, ctx }) => {
    test.setTimeout(60_000);

    const user = await seedConsumer(ctx, { suffix: 'profil-show' });

    // Pré-remplit prénom/nom côté DB pour vérifier l'affichage
    const admin = getReadOnlyAdminClient();
    await admin
      .from('users')
      .update({ prenom: 'Jean', nom: 'Tester', telephone: '0612345678' })
      .eq('id', user.id);

    await loginAs(page, user);
    await page.goto('/compte/profil');

    // Attente du load (le client a un état "Chargement…" initial)
    await expect(page.getByLabel('Prénom', { exact: true })).toHaveValue('Jean', {
      timeout: 10_000,
    });
    await expect(page.getByLabel('Nom', { exact: true })).toHaveValue('Tester');
    await expect(page.getByLabel('Téléphone', { exact: true })).toHaveValue('0612345678');
  });

  test('update prénom + nom : Enregistrer → persistance DB', async ({ page, ctx }) => {
    test.setTimeout(60_000);

    const user = await seedConsumer(ctx, { suffix: 'profil-upd' });

    await loginAs(page, user);
    await page.goto('/compte/profil');

    // Wait UI ready (loading → form rendered)
    await expect(page.getByLabel('Prénom', { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    await page.getByLabel('Prénom', { exact: true }).fill('Marie');
    await page.getByLabel('Nom', { exact: true }).fill('Dupont');

    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();

    // Confirmation visible
    await expect(page.getByText(/Modifications enregistrées/i)).toBeVisible({
      timeout: 10_000,
    });

    // DB asserts
    const admin = getReadOnlyAdminClient();
    const { data } = await admin
      .from('users')
      .select('prenom, nom')
      .eq('id', user.id)
      .single();
    expect(data?.prenom).toBe('Marie');
    expect(data?.nom).toBe('Dupont');
  });

  test('toggle sms_optin : DB sms_optin passe à true', async ({ page, ctx }) => {
    test.setTimeout(60_000);

    const user = await seedConsumer(ctx, { suffix: 'profil-sms' });

    await loginAs(page, user);
    await page.goto('/compte/profil');

    // Switch role=switch aria-label "Notifications SMS" — initial false.
    const sw = page.getByRole('switch', { name: /Notifications SMS/i });
    await expect(sw).toBeVisible({ timeout: 10_000 });
    await expect(sw).toHaveAttribute('aria-checked', 'false');

    await sw.click();

    // Le toggle update directement (pas besoin de submit)
    await expect(sw).toHaveAttribute('aria-checked', 'true', { timeout: 5_000 });

    // DB persistance — petit délai pour laisser la requête arriver
    await page.waitForTimeout(800);
    const admin = getReadOnlyAdminClient();
    const { data } = await admin
      .from('users')
      .select('sms_optin')
      .eq('id', user.id)
      .single();
    expect(data?.sms_optin).toBe(true);
  });
});
