/**
 * E2E admin — Isolation ACL : un user non-admin ne doit JAMAIS pouvoir
 * accéder aux pages /(admin)/* ni appeler les routes /api/admin/*.
 *
 * Couverture (2 tests) :
 *   1. Consumer authentifié → GET /tableau-de-bord redirect /connexion
 *      (layout admin enforce session.isAdmin via getSessionUser).
 *   2. Consumer authentifié → POST /api/admin/producers/invite → 403
 *      Forbidden (route handler enforce session.isAdmin upfront).
 *
 * NB : le middleware host-check (admin.terroir-local.fr) est gated
 * NODE_ENV='production' (cf. layout.tsx commentaire H-4). En local, c'est
 * le layout (admin) + le route handler qui sont les vrais gardiens — d'où
 * ce test ciblant ces 2 surfaces.
 */

import { test, expect } from '../helpers/test-context';
import { seedConsumer } from '../helpers/db-seed';
import { loginAs } from '../helpers/user-lifecycle';

test.describe('Admin — RLS isolation non-admin', () => {
  test('consumer logué tente /tableau-de-bord → bounced hors admin', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const consumer = await seedConsumer(ctx, { suffix: 'rls-cons-tdb' });
    await loginAs(page, consumer);

    await page.goto('/tableau-de-bord');
    // Le layout admin (app/(admin)/layout.tsx) `redirect("/connexion")` quand
    // !session.isAdmin. Mais /connexion a son propre layout qui détecte la
    // session active et re-redirige vers le post-login local (/compte pour
    // un consumer). Net : le consumer atterrit sur /compte. Dans tous les
    // cas, il n'est PAS sur /tableau-de-bord — c'est le critère de sécurité.
    await expect(page).not.toHaveURL(/\/tableau-de-bord/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/(compte|connexion)/, { timeout: 10_000 });
  });

  test('consumer logué appelle POST /api/admin/producers/invite → 403', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const consumer = await seedConsumer(ctx, { suffix: 'rls-cons-api' });
    await loginAs(page, consumer);

    // Le consumer a une session valide mais pas isAdmin → la route
    // renvoie 403 avant de toucher au body schema ou au rate-limit.
    const response = await page.request.post('/api/admin/producers/invite', {
      data: { email: 'playwright-test-9999999999-rls@mailinator.com' },
    });
    expect(response.status()).toBe(403);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe('Forbidden');
  });
});
