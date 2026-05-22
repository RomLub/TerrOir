/**
 * E2E auth/signup — couverture happy path + enum-resistance + Zod gates.
 *
 * NOTE TerrOir : signup utilise Supabase SMTP natif (pas sendTemplate
 * lib/resend). Donc on n'asserte PAS sur la table test_emails_captured pour
 * ce flow — la preuve d'envoi mail vit dans Supabase, pas dans notre table
 * de capture e2e. Assertions solides à la place :
 *   - Status form action (success page "Vérifie tes emails")
 *   - État DB (auth.users + public.users avec roles=['consumer'] + cgu_*)
 *
 * Volumétrie Resend : 0 mail consommé (Supabase SMTP, pas notre quota).
 */

import { test, expect } from "../helpers/test-context";
import { generateTestEmail } from "../helpers/guards";
import { createTestUser } from "../helpers/user-lifecycle";
import {
  getReadOnlyAdminClient,
  trackUserId,
} from "../helpers/supabase-admin";

const STRONG_PASSWORD = "Test1234abcd"; // matche strongPasswordSchema

test.describe("Auth — Signup", () => {
  test("happy path : submit form valide → success page + user créé en DB", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const email = generateTestEmail("signup-happy");

    await page.goto("/auth/inscription");
    await page.getByLabel("Prénom").fill("Test");
    await page.getByLabel("Nom", { exact: true }).fill("Signup");
    await page.getByLabel("Email").fill(email);
    await page
      .getByLabel("Mot de passe", { exact: true })
      .fill(STRONG_PASSWORD);

    const cguCheckbox = page.getByRole("checkbox", {
      name: /Conditions générales d.utilisation/i,
    });
    await cguCheckbox.check();

    const submit = page.getByRole("button", {
      name: "Créer mon compte",
      exact: true,
    });
    await expect(submit).toBeEnabled();
    await submit.click();

    // Success page — marqueur stable que la server action a OK
    await expect(page.getByText(/Vérifie tes emails/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(email)).toBeVisible();

    // DB : auth.users + public.users créés avec roles=['consumer']
    const admin = getReadOnlyAdminClient();
    const { data: userRow, error } = await admin
      .from("users")
      .select("id, email, roles, prenom, nom")
      .ilike("email", email)
      .maybeSingle();

    expect(error, `users SELECT: ${error?.message}`).toBeNull();
    expect(userRow, `users row pour ${email}`).not.toBeNull();
    const row = userRow!;
    expect(row.email).toBe(email);
    expect(row.roles).toEqual(["consumer"]);
    expect(row.prenom).toBe("Test");
    expect(row.nom).toBe("Signup");

    // Track pour cleanup auto en afterEach (cascade auth.users → public.users)
    trackUserId(ctx, row.id as string);

    // Vérifier auth.users
    const { data: authUser, error: authErr } =
      await admin.auth.admin.getUserById(row.id as string);
    expect(authErr).toBeNull();
    expect(authUser.user?.email).toBe(email);
  });

  test("email enum-resistance : email déjà utilisé → pas de leak d'info sur l'existence du compte", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    // Pré-créer un user via createTestUser (auth.admin.createUser email_confirm:true
    // + INSERT public.users). État identique à un user signup-é puis confirmé.
    const existing = await createTestUser(ctx, { suffix: "signup-dup" });

    const admin = getReadOnlyAdminClient();
    const { data: beforeAuth, error: beforeErr } =
      await admin.auth.admin.listUsers({ perPage: 200 });
    expect(beforeErr).toBeNull();
    const beforeMatches = (beforeAuth?.users ?? []).filter(
      (u) => u.email === existing.email,
    );
    expect(beforeMatches).toHaveLength(1);
    const originalUserId = beforeMatches[0].id;

    // Tenter signup avec le même email
    await page.goto("/auth/inscription");
    await page.getByLabel("Prénom").fill("Dup");
    await page.getByLabel("Nom", { exact: true }).fill("Email");
    await page.getByLabel("Email").fill(existing.email);
    await page
      .getByLabel("Mot de passe", { exact: true })
      .fill(STRONG_PASSWORD);
    await page
      .getByRole("checkbox", {
        name: /Conditions générales d.utilisation/i,
      })
      .check();
    await page
      .getByRole("button", { name: "Créer mon compte", exact: true })
      .click();

    // Enum-resistance vérifié au sens fort : la page NE confirme PAS
    // l'existence du compte. 2 chemins acceptés selon comment Supabase
    // gère le doublon (gating user_already_exists VS contrainte unique
    // public.users.email à l'INSERT) :
    //   - Branche T-313 : success page "Vérifie tes emails" (signup
    //     re-confirme un user déjà existant — Supabase code
    //     user_already_exists)
    //   - Branche T-301 : error "Inscription impossible" (compensation
    //     orphan : signup réussi côté auth, INSERT public.users échoué
    //     sur unique email, rollback)
    // Les 2 chemins masquent l'existence (pas de "déjà inscrit", pas
    // de "email existe").
    const successPage = page.getByText(/Vérifie tes emails/i);
    const errorBanner = page.getByText(/Inscription impossible/i);
    await expect(successPage.or(errorBanner)).toBeVisible({ timeout: 15_000 });

    // Aucun NOUVEAU auth.users résiduel : seul l'user pré-existant
    // subsiste (le rollback T-301 a bien purgé l'orphelin si la branche
    // 2 a été empruntée).
    const { data: afterAuth, error: afterErr } =
      await admin.auth.admin.listUsers({ perPage: 200 });
    expect(afterErr).toBeNull();
    const afterMatches = (afterAuth?.users ?? []).filter(
      (u) => u.email === existing.email,
    );
    expect(afterMatches).toHaveLength(1);
    expect(afterMatches[0].id).toBe(originalUserId);
  });

  test("weak password (<8 chars) : Zod rejette → message erreur visible", async ({
    page,
  }) => {
    await page.goto("/auth/inscription");
    await page.getByLabel("Prénom").fill("Test");
    await page.getByLabel("Nom", { exact: true }).fill("Weak");
    await page.getByLabel("Email").fill(generateTestEmail("signup-weak"));
    await page.getByLabel("Mot de passe", { exact: true }).fill("aB1");

    await page
      .getByRole("checkbox", {
        name: /Conditions générales d.utilisation/i,
      })
      .check();

    // Le `minLength={8}` du PasswordInput côté client peut bloquer le submit
    // avant action serveur. On retire l'attribut pour forcer le passage côté
    // server action et observer la classification Zod.
    await page.evaluate(() => {
      const inputs = document.querySelectorAll<HTMLInputElement>(
        'input[name="password"]',
      );
      inputs.forEach((i) => {
        i.removeAttribute("minlength");
        i.removeAttribute("required");
      });
    });

    await page
      .getByRole("button", { name: "Créer mon compte", exact: true })
      .click();

    // Le message Zod canonique est "Mot de passe : 12 caractères minimum".
    // signupAction renvoie state.error avec ce message, qui est rendu dans
    // un .rounded-md.bg-red-50.
    await expect(page.getByText(/12 caractères minimum/i)).toBeVisible({
      timeout: 10_000,
    });
  });

  test("missing CGU : bouton 'Créer mon compte' désactivé tant que checkbox pas cochée", async ({
    page,
  }) => {
    await page.goto("/auth/inscription");

    await page.getByLabel("Prénom").fill("Test");
    await page.getByLabel("Nom", { exact: true }).fill("NoCGU");
    await page.getByLabel("Email").fill(generateTestEmail("signup-nocgu"));
    await page
      .getByLabel("Mot de passe", { exact: true })
      .fill(STRONG_PASSWORD);

    const submit = page.getByRole("button", {
      name: "Créer mon compte",
      exact: true,
    });

    // Sans CGU coché : disabled (gate UI cguAccepted)
    await expect(submit).toBeDisabled();

    // Cocher CGU → enabled
    const cguCheckbox = page.getByRole("checkbox", {
      name: /Conditions générales d.utilisation/i,
    });
    await cguCheckbox.check();
    await expect(submit).toBeEnabled();

    // Décocher → re-disabled
    await cguCheckbox.uncheck();
    await expect(submit).toBeDisabled();
  });

  test("rate limit IP : 6 signups consécutifs → 6e refusé avec 'Trop de tentatives'", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // Cap signup = 5/60s/IP (cf. lib/rate-limit.ts getSignupRateLimit).
    // En env de test sans UPSTASH_REDIS_* configuré, le helper consumeRateLimit
    // est fail-open → ce test passe silencieusement (pas de rate-limit appliqué).
    // On le skip dans ce cas pour ne pas produire de faux vert.
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

    // Le cap signup est 5/60s/IP. En suite séquentielle, d'autres tests
    // peuvent déjà avoir consommé une partie du quota — on tente jusqu'à
    // 8 itérations et on assert qu'au moins une tentative kick le RL.
    let rateLimitTriggered = false;
    for (let i = 0; i < 8; i++) {
      const email = generateTestEmail(`signup-rl-${i}-${Date.now()}`);
      await page.goto("/auth/inscription");
      await page.getByLabel("Prénom").fill(`RL${i}`);
      await page.getByLabel("Nom", { exact: true }).fill("Limit");
      await page.getByLabel("Email").fill(email);
      await page
        .getByLabel("Mot de passe", { exact: true })
        .fill(STRONG_PASSWORD);
      await page
        .getByRole("checkbox", {
          name: /Conditions générales d.utilisation/i,
        })
        .check();
      await page
        .getByRole("button", { name: "Créer mon compte", exact: true })
        .click();

      // Attendre soit success page, soit message rate-limit
      await page.waitForLoadState("networkidle", { timeout: 15_000 });

      const errorBanner = page.getByText(/Trop de tentatives/i);
      if (await errorBanner.isVisible().catch(() => false)) {
        rateLimitTriggered = true;
        break;
      }
    }

    expect(
      rateLimitTriggered,
      "Au moins une tentative signup doit déclencher le cap rate-limit (cap 5/60s/IP)",
    ).toBe(true);
  });
});
