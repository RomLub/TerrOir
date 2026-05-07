/**
 * E2E security/admin-route-gate — vérifie que les routes admin (pages + API)
 * sont effectivement gardées pour un consumer authentifié non admin.
 *
 * Couverture (2 tests) :
 *   1. Pages admin SSR : un consumer logué qui visite plusieurs routes
 *      /(admin)/* est redirigé hors du tableau-de-bord (le layout admin
 *      `redirect("/connexion")` quand !session.isAdmin ; en cascade le
 *      layout connexion redirige le consumer vers /compte).
 *   2. API admin handlers : un consumer logué qui POST/GET sur /api/admin/*
 *      reçoit 403 Forbidden (route handlers vérifient isAdmin upfront).
 *
 * NB : ces tests sont complémentaires de admin-rls-isolation.spec.ts qui
 * couvre les variantes /tableau-de-bord + /api/admin/producers/invite. Ici
 * on étend la matrice à plusieurs routes pages + API pour ne pas avoir
 * un trou de gating sur une page secondaire seule.
 */

import { test, expect } from '../helpers/test-context';
import { seedConsumer } from '../helpers/db-seed';
import { loginAs } from '../helpers/user-lifecycle';

const ADMIN_PAGES = [
  '/audit-logs',
  '/gestion-producteurs',
  '/avis',
  '/suivi-commandes',
];

test.describe('Security — Admin route gate (consumer non-admin)', () => {
  test('pages /(admin)/* multiples : consumer non-admin → bounced hors admin', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(120_000);

    const consumer = await seedConsumer(ctx, { suffix: 'admin-gate-page' });
    await loginAs(page, consumer);

    for (const adminPath of ADMIN_PAGES) {
      await page.goto(adminPath);
      // Le layout (admin) redirect("/connexion") + le layout connexion
      // détecte la session active et redirige le consumer vers /compte.
      // Critère de sécurité : on n'atterrit JAMAIS sur la route admin.
      await expect(page, `Page ${adminPath} ne doit pas s'ouvrir`).not.toHaveURL(
        new RegExp(adminPath.replace(/\//g, '\\/')),
        { timeout: 10_000 },
      );
      // On vérifie en plus qu'on est sur /compte ou /connexion (pas un 200
      // sur la page admin avec UI vide qui leak).
      await expect(page).toHaveURL(/\/(compte|connexion)/, { timeout: 10_000 });
    }
  });

  test('API /api/admin/* : consumer non-admin → 403 Forbidden sur 2 routes différentes', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const consumer = await seedConsumer(ctx, { suffix: 'admin-gate-api' });
    await loginAs(page, consumer);

    // Route 1 : POST /api/admin/producers/invite (déjà testée ailleurs, on
    // confirme le pattern + on étend par une 2e route différente).
    const inviteRes = await page.request.post('/api/admin/producers/invite', {
      data: { email: 'playwright-test-9999999999-gate@mailinator.com' },
    });
    expect(inviteRes.status(), `producers/invite doit renvoyer 403`).toBe(403);
    const inviteBody = (await inviteRes.json().catch(() => ({}))) as {
      error?: string;
    };
    expect(inviteBody.error).toBe('Forbidden');

    // Route 2 : GET /api/admin/categories. Le route handler check
    // `session.isAdmin` AVANT toute lecture DB → 403 attendu pour un
    // consumer non-admin. Test complémentaire de POST/invite pour
    // vérifier que le pattern de gating est uniforme (et pas un 200
    // qui leak la liste catégories à un user non-admin).
    const catRes = await page.request.get('/api/admin/categories');
    expect(
      catRes.status(),
      `GET /api/admin/categories pour consumer non-admin doit retourner 403`,
    ).toBe(403);
    const catBody = (await catRes.json().catch(() => ({}))) as {
      error?: string;
    };
    expect(catBody.error).toBe('Forbidden');
  });
});
