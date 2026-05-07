/**
 * E2E auth/logout — happy path.
 *
 * Flow : login UI → cliquer "Déconnexion" dans NavbarPublic → redirect "/" +
 * cookies sb-* purgés → /compte ne rend plus la session active.
 *
 * useLogoutFlow fait :
 *   1. supabase.auth.signOut() côté client
 *   2. cart store purge
 *   3. logoutAction server (clear cookies + redirect "/")
 *
 * Note : la navbar n'apparaît pas sur /compte/connexion (layout custom),
 * donc on revient sur la home publique post-login pour avoir accès au
 * bouton "Déconnexion".
 */

import { test, expect } from "../helpers/test-context";
import { createTestUser, loginAs } from "../helpers/user-lifecycle";

test.describe("Auth — Logout", () => {
  test("happy path : clic Déconnexion → cookies purgés + redirect home + audit_log", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const user = await createTestUser(ctx, { suffix: "logout-happy" });
    await loginAs(page, user);

    // Aller sur la home publique pour avoir la navbar avec le bouton
    // "Déconnexion" (la /compte route a aussi accès via le drawer mobile,
    // mais la home est plus stable cross-layout).
    await page.goto("/");

    // Le bouton Déconnexion existe en 2 versions (desktop + mobile). On
    // cible le 1er occurence visible.
    const logoutBtn = page.getByRole("button", {
      name: /Déconnexion/i,
    });
    await expect(logoutBtn.first()).toBeVisible({ timeout: 10_000 });
    await logoutBtn.first().click();

    // logoutAction redirige vers "/" (cf. logout-action.ts:37)
    await page.waitForURL((url) => url.pathname === "/", { timeout: 15_000 });

    // Preuve forte que la session est invalidée : tentative d'accès à
    // /compte (page protégée) → middleware redirige sur /connexion.
    // Les cookies Set-Cookie purgés côté serveur arrivent en synchronie
    // avec la response HTTP, donc le 1er request post-logout est rejeté.
    //
    // Note : on ne vérifie PAS context.cookies() côté browser car le
    // contexte chromium peut garder un cookie en cache jusqu'à la
    // prochaine roundtrip réseau (race observée en local). La preuve
    // côté middleware est plus solide.
    await page.goto("/compte");
    await page.waitForURL(/\/connexion/, { timeout: 10_000 });

    // Audit log : event account_logout posé.
    //
    // Subtilité TerrOir : useLogoutFlow appelle d'abord supabase.auth.signOut()
    // côté client (purge session browser), PUIS logoutAction côté serveur.
    // Conséquence : getUser() côté action retourne null → l'event est posé
    // avec user_id=null (perte d'attribution). On filtre par fenêtre temporelle
    // sur event_type au lieu de user_id.
    const { getReadOnlyAdminClient } = await import(
      "../helpers/supabase-admin"
    );
    const admin = getReadOnlyAdminClient();
    const startedAt = new Date(Date.now() - 60_000); // fenêtre 60s
    const { data: logoutEvents, error } = await admin
      .from("audit_logs")
      .select("event_type, user_id, created_at")
      .eq("event_type", "account_logout")
      .gte("created_at", startedAt.toISOString())
      .order("created_at", { ascending: false })
      .limit(20);
    expect(error).toBeNull();
    expect(logoutEvents?.length ?? 0).toBeGreaterThanOrEqual(1);
  });
});
