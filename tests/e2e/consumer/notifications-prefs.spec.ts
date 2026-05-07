/**
 * E2E consumer/notifications — préférences notification email opt-out.
 *
 * Architecture (cf. lib/notifications/preferences.ts) :
 *   - Defaults virtuels : true partout, no row needed à la création de compte
 *   - PATCH /api/consumer/notification-preferences upsert la row scoped user_id
 *   - Lecture SSR via getUserNotificationPreferences()
 *
 * Couverture :
 *   - Affichage page : toggle visible avec default true (opt-out)
 *   - PATCH update toggle off → DB row email_review_response=false
 *   - Defaults virtuels : pas de row pré-existante avant 1er toggle (read
 *     retourne defaults sans INSERT)
 */

import { test, expect } from '../helpers/test-context';
import { seedConsumer } from '../helpers/db-seed';
import { loginAs } from '../helpers/user-lifecycle';
import { getReadOnlyAdminClient } from '../helpers/supabase-admin';

test.describe('Consumer — /compte/notifications', () => {
  test('affichage : toggle email_review_response visible avec default true', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const user = await seedConsumer(ctx, { suffix: 'notif-show' });
    await loginAs(page, user);
    await page.goto('/compte/notifications');

    // Le label de la pref est "Réponse d'un producteur à mon avis"
    await expect(
      page.getByRole('heading', { name: 'Notifications', exact: true }),
    ).toBeVisible({ timeout: 10_000 });

    // Toggle role=switch aria-label = label de la pref
    const sw = page.getByRole('switch', {
      name: /Réponse d['’]un producteur à mon avis/i,
    });
    await expect(sw).toBeVisible();
    // Default opt-out = true
    await expect(sw).toHaveAttribute('aria-checked', 'true');
  });

  test('défaults virtuels : aucune row user_notification_preferences pré-toggle', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const user = await seedConsumer(ctx, { suffix: 'notif-default' });
    await loginAs(page, user);
    await page.goto('/compte/notifications');

    // Le SSR a fait un getUserNotificationPreferences → si pas de row, return
    // DEFAULT_NOTIFICATION_PREFERENCES sans INSERT. Vérifions qu'aucune row
    // n'existe pour cet user à ce stade.
    await expect(
      page.getByRole('switch', {
        name: /Réponse d['’]un producteur à mon avis/i,
      }),
    ).toBeVisible({ timeout: 10_000 });

    const admin = getReadOnlyAdminClient();
    const { data } = await admin
      .from('user_notification_preferences')
      .select('user_id')
      .eq('user_id', user.id);
    expect(data?.length ?? 0).toBe(0);
  });

  test('toggle off : PATCH puis DB row updated email_review_response=false', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const user = await seedConsumer(ctx, { suffix: 'notif-tog' });
    await loginAs(page, user);
    await page.goto('/compte/notifications');

    const sw = page.getByRole('switch', {
      name: /Réponse d['’]un producteur à mon avis/i,
    });
    await expect(sw).toBeVisible({ timeout: 10_000 });
    await expect(sw).toHaveAttribute('aria-checked', 'true');

    await sw.click();

    // UI feedback "Préférence mise à jour"
    await expect(page.getByText(/Préférence mise à jour/i)).toBeVisible({
      timeout: 10_000,
    });
    await expect(sw).toHaveAttribute('aria-checked', 'false');

    // DB upsert assertion
    const admin = getReadOnlyAdminClient();
    const { data } = await admin
      .from('user_notification_preferences')
      .select('email_review_response')
      .eq('user_id', user.id)
      .single();
    expect(data?.email_review_response).toBe(false);
  });
});
