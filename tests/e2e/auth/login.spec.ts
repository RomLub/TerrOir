/**
 * E2E auth/login — happy path + error handling + redirect post-login + RL.
 *
 * Pattern : createTestUser via auth.admin (email auto-confirmed) puis
 * loginAs UI sur /connexion. Le helper loginAs valide déjà le happy path
 * implicitement (waitForURL hors /connexion), on ajoute des assertions
 * fines (path final, audit log, etc.).
 */

import { test, expect } from "../helpers/test-context";
import { generateTestEmail } from "../helpers/guards";
import { createTestUser, loginAs } from "../helpers/user-lifecycle";
import { getReadOnlyAdminClient } from "../helpers/supabase-admin";

const STRONG_PASSWORD = "Test1234";

test.describe("Auth — Login", () => {
  test("happy path : login UI → redirect /compte + session active", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const user = await createTestUser(ctx, { suffix: "login-happy" });

    await loginAs(page, user);

    // Helper waitForURL filtre déjà sur sortie de /connexion → ici on vérifie
    // la cible canonique consumer (resolvePostLoginPath fallback /compte).
    await expect(page).toHaveURL(/\/compte/, { timeout: 10_000 });

    // Audit log : event account_login_password posé pour cet user
    const admin = getReadOnlyAdminClient();
    const { data: auditLogs, error: auditErr } = await admin
      .from("audit_logs")
      .select("event_type")
      .eq("user_id", user.id)
      .eq("event_type", "account_login_password");
    expect(auditErr).toBeNull();
    expect(auditLogs?.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  test("wrong password : message d'erreur générique 'Identifiants invalides'", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const user = await createTestUser(ctx, { suffix: "login-wrongpwd" });

    await page.goto("/connexion");
    await page.getByLabel("Email", { exact: true }).fill(user.email);
    await page
      .getByLabel("Mot de passe", { exact: true })
      .fill("WrongPassword999");
    await page
      .getByRole("button", { name: "Se connecter", exact: true })
      .click();

    // Le bandeau d'erreur affiche EXACTEMENT "Identifiants invalides"
    // (cf. loginAction return). Enumeration-resistance : pas de
    // distinction email inexistant vs mauvais mdp.
    //
    // Edge case : si le rate-limit IP login est atteint (cumul d'autres
    // tests login_failed dans la même fenêtre 60s), le message devient
    // "Trop de tentatives" — toujours un échec attendu, on tolère les 2
    // formes pour robustesse en suite séquentielle.
    await expect(
      page.getByText(/Identifiants invalides|Trop de tentatives/i),
    ).toBeVisible({ timeout: 10_000 });

    // On reste sur /connexion (pas de redirect)
    await expect(page).toHaveURL(/\/connexion/);

    // Audit log : login_failed OU rate_limit_exceeded présent dans les
    // events récents (60 dernières secondes). Le metadata.email_masked du
    // user permet une attribution forensique côté backoffice (test ne
    // l'asserte pas faute de helper de masking accessible côté tests).
    const admin = getReadOnlyAdminClient();
    const recentCutoff = new Date(Date.now() - 60_000).toISOString();
    const { data: failed, error } = await admin
      .from("audit_logs")
      .select("event_type, metadata, created_at")
      .gte("created_at", recentCutoff)
      .in("event_type", ["login_failed", "rate_limit_exceeded"])
      .order("created_at", { ascending: false })
      .limit(50);
    expect(error).toBeNull();
    expect(failed?.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  test("unconfirmed email : login refusé avec erreur générique", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    // Créer user avec email_confirm: false → Supabase rejette signInWithPassword
    // avec code email_not_confirmed.
    const user = await createTestUser(ctx, {
      suffix: "login-unconfirmed",
      emailConfirmed: false,
    });

    await page.goto("/connexion");
    await page.getByLabel("Email", { exact: true }).fill(user.email);
    await page.getByLabel("Mot de passe", { exact: true }).fill(user.password);
    await page
      .getByRole("button", { name: "Se connecter", exact: true })
      .click();

    // loginAction renvoie le message UI générique "Identifiants invalides"
    // pour préserver l'enumeration-resistance (pas de distinction
    // email-exists-but-unconfirmed vs invalid). Le code interne classifie
    // dans audit_logs metadata.reason_code = 'email_not_confirmed'.
    //
    // Tolérance rate-limit : en suite séquentielle, l'IP peut être au cap
    // login (5/60s) — on accepte les 2 messages d'échec.
    await expect(
      page.getByText(/Identifiants invalides|Trop de tentatives/i),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/connexion/);

    // Audit forensique : login_failed (reason_code=email_not_confirmed) OU
    // rate_limit_exceeded route=login. Au moins l'un des 2 dans les 60s.
    const admin = getReadOnlyAdminClient();
    const recentCutoff = new Date(Date.now() - 60_000).toISOString();
    const { data: failed, error } = await admin
      .from("audit_logs")
      .select("event_type, metadata, created_at")
      .gte("created_at", recentCutoff)
      .in("event_type", ["login_failed", "rate_limit_exceeded"])
      .order("created_at", { ascending: false })
      .limit(50);
    expect(error).toBeNull();
    expect(failed?.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  test("redirect post-login : ?redirectTo=/compte/commandes respecté", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const user = await createTestUser(ctx, { suffix: "login-redir" });

    await page.goto("/connexion?redirectTo=/compte/commandes");
    await page.getByLabel("Email", { exact: true }).fill(user.email);
    await page.getByLabel("Mot de passe", { exact: true }).fill(user.password);
    await page
      .getByRole("button", { name: "Se connecter", exact: true })
      .click();

    // resolvePostLoginPath valide /compte/commandes (path local, starts with /)
    // et le respecte vs canonical /compte
    await expect(page).toHaveURL(/\/compte\/commandes/, { timeout: 15_000 });
  });

  test("rate limit IP : 6 logins consécutifs → 6e refusé avec 'Trop de tentatives'", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(120_000);

    // Cap login = 5/60s/IP (cf. lib/rate-limit.ts getLoginRateLimit). Skip
    // si Upstash absent (fail-open silencieux côté consumeRateLimit).
    const hasUpstash = Boolean(
      process.env.UPSTASH_REDIS_REST_URL &&
        process.env.UPSTASH_REDIS_REST_TOKEN,
    );
    test.skip(
      !hasUpstash,
      "UPSTASH_REDIS_REST_URL/TOKEN absent — rate-limit fail-open, test non vérifiable",
    );

    // En local dev, ce test sature le compteur Redis pour tous les tests
    // ultérieurs. On le skip par défaut sauf si E2E_TEST_RATE_LIMITS=true.
    test.skip(
      process.env.E2E_TEST_RATE_LIMITS !== "true",
      "Skipped : E2E_TEST_RATE_LIMITS!=true (le RL pollue les tests suivants)",
    );

    // On utilise un email valide pour ne pas attaquer un compte inexistant
    // (le rate-limit s'applique avant signInWithPassword donc même un
    // mauvais mdp consomme le quota IP).
    const user = await createTestUser(ctx, { suffix: "login-rl" });

    let rateLimitTriggered = false;
    for (let i = 0; i < 6; i++) {
      await page.goto("/connexion");
      await page.getByLabel("Email", { exact: true }).fill(user.email);
      await page
        .getByLabel("Mot de passe", { exact: true })
        .fill("WrongOnPurpose9");
      await page
        .getByRole("button", { name: "Se connecter", exact: true })
        .click();

      await page.waitForLoadState("networkidle", { timeout: 15_000 });

      if (
        await page
          .getByText(/Trop de tentatives/i)
          .isVisible()
          .catch(() => false)
      ) {
        rateLimitTriggered = true;
        expect(i).toBeGreaterThanOrEqual(5);
        break;
      }
    }

    expect(
      rateLimitTriggered,
      "Le 6ème login doit déclencher le cap rate-limit",
    ).toBe(true);
  });
});
